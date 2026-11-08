// Spieler wählbar (D050) und eigene Abweichung (D052). Hervorhebung in der Rangliste und die eigene Wahl gelten
// für das gewählte Kürzel. Die Tippdatei schlägt seit D052 für alle den Favoriten vor, eine Abweichung wählt der
// Nutzer im Spielblatt. Push bleibt beim Hauptnutzer. Gespeichert nur lokal, jeder Storage Zugriff ausfalltolerant.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Game } from "../core/schema";
import { PLAYER_IDS } from "../core/standings";
import { isLocked, roundProb, tiebreakerFor } from "../core/tips";
import type { GameTip, StandingsFile, TipsFile } from "../core/tips-schema";
import type { ReviewFile } from "../core/review-schema";
import { loadTipsData, useKeptLoad, weekKey, type WeekPhase, type WeekRef } from "./data";

export const PLAYER_KEY = "nfl-dashboard:spieler";

// Ersatz für den Privatmodus: ohne Storage gilt die Wahl bis zum Neuladen
let memory: string | null = null;
let memorySet = false;
const listeners = new Set<() => void>();

export function readStoredPlayer(): string | null {
  if (memorySet) return memory;
  try {
    return window.localStorage.getItem(PLAYER_KEY);
  } catch {
    return null;
  }
}

/** Speichert das Kürzel, null heisst zurück zum Hauptnutzer. */
export function storePlayer(id: string | null): void {
  memory = id;
  memorySet = true;
  try {
    if (id === null) window.localStorage.removeItem(PLAYER_KEY);
    else window.localStorage.setItem(PLAYER_KEY, id);
    // Storage hat geklappt, ab jetzt wieder von dort lesen (andere Tabs)
    memorySet = false;
  } catch {
    // Ohne Storage bleibt die Wahl im Speicher dieser Sitzung
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PLAYER_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Kürzel zur Auswahl: aus der Rangliste, ohne Rangliste die bekannten Kürzel des Formulars. */
export function playerChoices(standings: StandingsFile | null): string[] {
  const ids = standings && standings.players.length > 0 ? standings.players.map((p) => p.id) : [...PLAYER_IDS];
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Gewähltes Kürzel, wenn es in der Rangliste steht, sonst der Hauptnutzer (standings.me). */
export function resolvePlayer(stored: string | null, standings: StandingsFile | null): string | null {
  if (!standings) return stored;
  if (stored && standings.players.some((p) => p.id === stored)) return stored;
  return standings.me;
}

export interface PlayerState {
  /** Wirksames Kürzel, null nur ohne Rangliste und ohne Wahl. */
  player: string | null;
  /** Hauptnutzer der Tippdatei und der Push Erinnerungen. */
  main: string | null;
  /** true, wenn ein anderer Spieler als der Hauptnutzer gewählt ist. */
  other: boolean;
  choose: (id: string) => void;
}

export function usePlayer(standings: StandingsFile | null): PlayerState {
  const stored = useSyncExternalStore(subscribe, readStoredPlayer, () => null);
  const player = resolvePlayer(stored, standings);
  const main = standings?.me ?? null;
  // Wahl des Hauptnutzers löscht den Eintrag, dann folgt die App einem späteren Wechsel von standings.me
  const choose = useCallback((id: string) => storePlayer(main !== null && id === main ? null : id), [main]);
  return { player, main, other: player !== null && main !== null && player !== main, choose };
}

/** Rangliste für Einstellungen und Onboarding, aus dem Sitzungscache der aktuellen Tippwoche. */
export function useStandings(): StandingsFile | null {
  const { data } = useKeptLoad("tipps:", () => loadTipsData(null));
  return data?.standings ?? null;
}

/** Rangliste aus Sicht des gewählten Spielers: nur me wechselt. */
export function standingsFor(standings: StandingsFile, player: string | null): StandingsFile {
  if (!player || player === standings.me || !standings.players.some((p) => p.id === player)) return standings;
  return { ...standings, me: player };
}

// ---------- Eigene Abweichung (D052) ----------
// Pro Spieler und Woche ein Eintrag: Objekt gameId zu gewähltem Team. Fehlt ein Spiel, gilt der Vorschlag der App.

export const CHOICE_PREFIX = "nfl-dashboard:wahl:";

/** Wahl pro Spiel: gameId zu teamId des gewählten Aussenseiters. */
export type Choices = Readonly<Record<string, string>>;

const EMPTY_CHOICES: Choices = Object.freeze({});

/** Schlüssel im localStorage, z. B. nfl-dashboard:wahl:JA:2026-2-09. Ohne Kürzel steht "ohne". */
export function choiceKey(player: string | null, ref: Pick<WeekRef, "season" | "seasonType" | "week">): string {
  return `${CHOICE_PREFIX}${player ?? "ohne"}:${ref.season}-${ref.seasonType}-${String(ref.week).padStart(2, "0")}`;
}

/** Liest nur gültige Einträge, alles andere gilt als keine Wahl. */
export function parseChoices(raw: string | null): Choices {
  if (!raw) return EMPTY_CHOICES;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_CHOICES;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) if (typeof v === "string" && v.length > 0) out[k] = v;
    return out;
  } catch {
    return EMPTY_CHOICES;
  }
}

// Ersatz ohne Storage: Wahl bis zum Neuladen. Der Cache hält pro Schlüssel denselben Wert, solange der Text gleich
// bleibt, sonst rechnet useSyncExternalStore endlos neu.
const choiceMemory = new Map<string, string | null>();
const choiceCache = new Map<string, { raw: string | null; value: Choices }>();
const choiceListeners = new Set<() => void>();

function readChoiceRaw(key: string): string | null {
  if (choiceMemory.has(key)) return choiceMemory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readChoices(key: string): Choices {
  const raw = readChoiceRaw(key);
  const hit = choiceCache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  const value = parseChoices(raw);
  choiceCache.set(key, { raw, value });
  return value;
}

/** Setzt oder löscht die Wahl eines Spiels. teamId null heisst zurück zum Vorschlag der App. */
export function storeChoice(key: string, gameId: string, teamId: string | null): void {
  const next: Record<string, string> = { ...readChoices(key) };
  if (teamId === null) delete next[gameId];
  else next[gameId] = teamId;
  const raw = Object.keys(next).length > 0 ? JSON.stringify(next) : null;
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
    choiceMemory.delete(key);
  } catch {
    // Ohne Storage gilt die Wahl bis zum Neuladen
    choiceMemory.set(key, raw);
  }
  for (const l of choiceListeners) l();
}

function subscribeChoices(listener: () => void): () => void {
  choiceListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(CHOICE_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    choiceListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export interface ChoiceState {
  choices: Choices;
  /** teamId null heisst zurück zum Favoriten. */
  setChoice: (gameId: string, teamId: string | null) => void;
}

/** Eigene Wahl für Spieler und Woche. Ohne Woche leer. */
export function useChoices(player: string | null, ref: WeekRef | null | undefined): ChoiceState {
  const key = ref ? choiceKey(player, ref) : null;
  const choices = useSyncExternalStore(
    subscribeChoices,
    () => (key ? readChoices(key) : EMPTY_CHOICES),
    () => EMPTY_CHOICES,
  );
  const setChoice = useCallback(
    (gameId: string, teamId: string | null) => {
      if (key) storeChoice(key, gameId, teamId);
    },
    [key],
  );
  return { choices, setChoice };
}

/**
 * Wendet die eigene Wahl auf die Tippdatei an (D052). Gilt nur, wenn das gewählte Team zum Spiel gehört, der Tipp
 * eine Quote hat und das Team nicht ohnehin der Vorschlag ist. Der Tipp wird dann zum Aussenseiter mit dessen
 * Wahrscheinlichkeit und deviation true. Der Tiebreaker des Spiels folgt dem getippten Team: der Aussenseiter
 * gewinnt mit 3 Punkten bei gleichem Total (D026). Nach Kickoff lässt die Oberfläche keine neue Wahl zu, eine
 * vorher getroffene Wahl bleibt angezeigt, so wie sie eingetragen wurde.
 */
export function applyChoices(tips: TipsFile, games: readonly Game[], choices: Choices): TipsFile {
  if (Object.keys(choices).length === 0) return tips;
  const gameById = new Map(games.map((g) => [g.id, g]));
  const chosen = new Set<string>();
  const out = tips.tips.map((t): GameTip => {
    const teamId = choices[t.gameId];
    const game = gameById.get(t.gameId);
    if (!teamId || !game || t.pickTeamId === null || t.pickProb === null) return t;
    if (t.level === "offen" || t.level === "nicht_erfasst") return t;
    if (teamId !== game.homeId && teamId !== game.awayId) return t;
    if (teamId === t.pickTeamId) return t;
    chosen.add(t.gameId);
    // Grundtipp und Änderungsmarke beziehen sich auf den Vorschlag der App, die eigene Wahl markiert die Liste
    return { ...t, pickTeamId: teamId, pickProb: roundProb(1 - t.pickProb), deviation: true, changedSinceFirst: false };
  });
  if (chosen.size === 0) return tips;
  const tipById = new Map(out.map((t) => [t.gameId, t]));
  const tiebreakers = tips.tiebreakers.map((tb) => {
    const tip = tipById.get(tb.gameId);
    const game = gameById.get(tb.gameId);
    if (!tip || !game || !chosen.has(tb.gameId)) return tb;
    return tiebreakerFor(game, tip.odds, tb.slot, tip);
  });
  return { ...tips, tips: out, tiebreakers };
}

// ---------- Häkchen eingetragen pro Spieler ----------
// Gespeichert wird das getippte Team, damit eine spätere Änderung des Tipps erkannt wird. Alte Einträge ohne
// Kürzel stammen aus der Zeit vor der Spielerwahl und gehören dem Hauptnutzer.

const ENTERED_PREFIX = "nfl-dashboard:eingetragen:";

type WeekPart = Pick<WeekRef, "season" | "seasonType" | "week">;
const weekPart = (ref: WeekPart) => `${ref.season}-${ref.seasonType}-${String(ref.week).padStart(2, "0")}`;

/** Schlüssel mit Kürzel, z. B. nfl-dashboard:eingetragen:JA:2026-2-09:401873037. Ohne Kürzel der alte Schlüssel. */
export function enteredKey(player: string | null, ref: WeekPart, gameId: string): string {
  return player ? `${ENTERED_PREFIX}${player}:${weekPart(ref)}:${gameId}` : legacyEnteredKey(ref, gameId);
}

/** Schlüssel vor der Spielerwahl, gilt für den Hauptnutzer. */
export function legacyEnteredKey(ref: WeekPart, gameId: string): string {
  return `${ENTERED_PREFIX}${weekPart(ref)}:${gameId}`;
}

/** Kleinster Ausschnitt von localStorage, für Tests ersetzbar. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browserStore = (): KeyStore | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Alte Werte "1" oder "true" ohne Team gelten als nicht eingetragen. */
const enteredValue = (v: string | null): string | null => (v === null || v === "1" || v === "true" ? null : v);

/** Gespeichertes Team oder null. Der Hauptnutzer liest auch alte Einträge ohne Kürzel. */
export function readEntered(
  player: string | null,
  main: string | null,
  ref: WeekPart,
  gameId: string,
  store: KeyStore | null = browserStore(),
): string | null {
  if (!store) return null;
  try {
    const own = enteredValue(store.getItem(enteredKey(player, ref, gameId)));
    if (own !== null || !player || player !== main) return own;
    return enteredValue(store.getItem(legacyEnteredKey(ref, gameId)));
  } catch {
    return null;
  }
}

/** Setzt oder löscht das Häkchen. Für den Hauptnutzer wird ein alter Eintrag dabei entfernt. */
export function writeEntered(
  player: string | null,
  main: string | null,
  ref: WeekPart,
  gameId: string,
  value: string | null,
  store: KeyStore | null = browserStore(),
): void {
  if (!store) return;
  try {
    const key = enteredKey(player, ref, gameId);
    if (value !== null) store.setItem(key, value);
    else store.removeItem(key);
    if (player && player === main) store.removeItem(legacyEnteredKey(ref, gameId));
  } catch {
    // Ohne Storage bleibt das Häkchen nur bis zum Neuladen erhalten
  }
}

/** Spiel gesperrt für eine neue Wahl: Tipp gesperrt, Kickoff vorbei oder nicht mehr geplant. */
export function choiceLocked(tip: Pick<GameTip, "locked" | "level">, game: Pick<Game, "kickoffUtc" | "status">, now: string): boolean {
  return tip.locked || tip.level === "nicht_erfasst" || isLocked(game, now);
}

/**
 * Tippdatei, wie Tipps und Spiele sie zeigen: Vorschlag der App mit der eigenen Wahl. Eine Funktion für beide
 * Reiter, damit nie zwei Tipps erscheinen. Vergangene Wochen eines anderen Spielers zeigen die Datei des
 * Hauptnutzers ohne Wahl, dessen Wahl liegt nur auf seinem Gerät.
 */
export function shownTipsFor(
  tips: TipsFile | null,
  games: readonly Game[] | null | undefined,
  standings: StandingsFile | null,
  phase: WeekPhase,
  player: string | null,
  choices: Choices = EMPTY_CHOICES,
): TipsFile | null {
  if (!tips || !games) return tips;
  const other = standings !== null && player !== null && player !== standings.me;
  if (phase === "vergangen" && other) return tips;
  return applyChoices(tips, games, choices);
}

/** shownTipsFor als Hook, neu gerechnet bei neuen Daten, anderem Spieler oder neuer Wahl. */
export function useShownTips(
  tips: TipsFile | null,
  games: readonly Game[] | null | undefined,
  standings: StandingsFile | null,
  phase: WeekPhase,
  player: string | null,
  choices: Choices = EMPTY_CHOICES,
): TipsFile | null {
  return useMemo(
    () => shownTipsFor(tips, games, standings, phase, player, choices),
    [tips, games, standings, phase, player, choices],
  );
}

// ---------- Eigene Wahl in Bilanz und Saison (D057) ----------

/**
 * Bilanz einer Woche mit der eigenen Wahl. Ein Spiel zählt mit dem gewählten Team, wenn die Bilanz einen App Tipp
 * hat und die Wahl ein anderes Team ist. Mit games muss das Team zum Spiel gehören. Punkte, Abweichung, Wirkung
 * und Netto werden neu gerechnet wie in jobs/build-review (Unentschieden zählt als falsch, Wirkung 0).
 * Der Tiebreaker bleibt der gespeicherte. changed zählt die Spiele mit eigener Wahl.
 */
export function applyChoicesToReview(
  review: ReviewFile,
  choices: Choices,
  games: readonly Pick<Game, "id" | "homeId" | "awayId">[] | null = null,
): { review: ReviewFile; changed: number } {
  if (Object.keys(choices).length === 0) return { review, changed: 0 };
  const gameById = games ? new Map(games.map((g) => [g.id, g])) : null;
  let changed = 0;
  const rows = review.games.map((r) => {
    const teamId = choices[r.gameId];
    if (!teamId || r.pickTeamId === null || teamId === r.pickTeamId) return r;
    const game = gameById?.get(r.gameId);
    if (gameById && (!game || (teamId !== game.homeId && teamId !== game.awayId))) return r;
    changed++;
    const deviation = r.favoriteTeamId !== null ? teamId !== r.favoriteTeamId : true;
    const correct = r.final ? teamId === r.winnerTeamId : null;
    const deviationEffect = deviation && r.final ? (r.winnerTeamId === null ? 0 : r.winnerTeamId === teamId ? 1 : -1) : null;
    return { ...r, pickTeamId: teamId, deviation, correct, deviationEffect };
  });
  if (changed === 0) return { review, changed: 0 };
  return {
    review: {
      ...review,
      games: rows,
      points: rows.filter((r) => r.correct === true).length,
      deviationNet: rows.reduce((s, r) => s + (r.deviationEffect ?? 0), 0),
    },
    changed,
  };
}

/**
 * Tippdatei einer vergangenen Woche mit der eigenen Wahl, für die Saisonauswertung (Erwartung laut Quote).
 * Ohne Spielplan: die Wahl gilt, wenn sie vom Tipp abweicht. Der Tipp wird zum anderen Team mit 1 minus p.
 */
export function applyChoicesToTipsLoose(tips: TipsFile, choices: Choices): TipsFile {
  if (Object.keys(choices).length === 0) return tips;
  let changed = false;
  const out = tips.tips.map((t): GameTip => {
    const teamId = choices[t.gameId];
    if (!teamId || t.pickTeamId === null || t.pickProb === null || teamId === t.pickTeamId) return t;
    if (t.level === "offen" || t.level === "nicht_erfasst") return t;
    changed = true;
    return { ...t, pickTeamId: teamId, pickProb: roundProb(1 - t.pickProb), deviation: true, changedSinceFirst: false };
  });
  return changed ? { ...tips, tips: out } : tips;
}

/** Bilanzen und Tippdateien einer Saison mit der eigenen Wahl pro Woche. changed zählt Spiele mit eigener Wahl. */
export function applySeasonChoices(
  reviews: readonly ReviewFile[],
  tips: readonly TipsFile[],
  choicesByWeek: ReadonlyMap<string, Choices>,
): { reviews: ReviewFile[]; tips: TipsFile[]; changed: number } {
  let changed = 0;
  const outReviews = reviews.map((r) => {
    const c = choicesByWeek.get(weekKey(r));
    if (!c) return r;
    const res = applyChoicesToReview(r, c);
    changed += res.changed;
    return res.review;
  });
  const outTips = tips.map((t) => {
    const c = choicesByWeek.get(weekKey(t));
    return c ? applyChoicesToTipsLoose(t, c) : t;
  });
  return { reviews: outReviews, tips: outTips, changed };
}

/**
 * Eigene Wahl für mehrere Wochen, als Map weekKey zu Wahl. Neu gelesen bei jeder Änderung einer Wahl, auch aus
 * anderen Tabs. Der Schnappschuss ist der verbundene Text der Einträge, damit useSyncExternalStore stabil bleibt.
 */
export function useChoicesFor(player: string | null, refs: readonly WeekRef[]): ReadonlyMap<string, Choices> {
  const keys = refs.map((r) => choiceKey(player, r));
  const snapshot = useSyncExternalStore(
    subscribeChoices,
    () => keys.map((k) => readChoiceRaw(k) ?? "").join("\u0001"),
    () => "",
  );
  const refKey = refs.map(weekKey).join(",");
  return useMemo(() => {
    const raws = snapshot.split("\u0001");
    const map = new Map<string, Choices>();
    refs.forEach((r, i) => {
      const c = parseChoices(raws[i] || null);
      if (Object.keys(c).length > 0) map.set(weekKey(r), c);
    });
    return map;
    // refKey fasst refs zusammen
  }, [snapshot, refKey]);
}
