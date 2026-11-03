// Spieler wählbar (D050). Ziel Platz 1, Hervorhebung in der Rangliste und Abweichungen gelten für das gewählte
// Kürzel. Die Tippdatei rechnet der Job für standings.me, für einen anderen Spieler rechnet der Browser die
// offenen Spiele neu. Push bleibt beim Hauptnutzer. Gespeichert nur lokal, jeder Storage Zugriff ausfalltolerant.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Game } from "../core/schema";
import { PLAYER_IDS, standingsAppliesTo } from "../core/standings";
import {
  chooseDeviations,
  favoriteTip,
  gapToTarget,
  isLocked,
  maxDeviations,
  roundProb,
  tiebreakerFor,
} from "../core/tips";
import type { GameTip, StandingsFile, TipsFile } from "../core/tips-schema";
import { loadTipsData, useKeptLoad, type WeekPhase } from "./data";

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
  /** true, wenn der Browser für einen anderen Spieler als den Hauptnutzer rechnet. */
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

/**
 * Tipps für einen anderen Spieler im Browser neu rechnen. Erlaubte Abweichungen aus dessen Rückstand auf
 * Platz 1 (D026, D028), Rangliste aus einer anderen Saison zählt als Rückstand 0 (D051). Offene, nicht gesperrte
 * Spiele bekommen den Favoriten als Tipp und die Abweichungen werden neu gewählt wie im Job. Gesperrte Spiele,
 * Grundtipp und gesperrte Tiebreaker bleiben. Für den Hauptnutzer kommt die Datei unverändert zurück.
 */
export function tipsForPlayer(
  tips: TipsFile,
  games: readonly Game[],
  standings: StandingsFile,
  player: string | null,
  now: string,
): TipsFile {
  if (!player || player === standings.me || !standings.players.some((p) => p.id === player)) return tips;
  const view = { ...standings, me: player };
  const gap = standingsAppliesTo(view, tips.season) ? gapToTarget(view) : 0;
  const max = maxDeviations(gap, tips.seasonType, tips.week);
  const gameById = new Map(games.map((g) => [g.id, g]));
  // Gesperrt auch ab Kickoff, wenn der stündliche Job das Spiel noch nicht gesperrt hat
  const lockedNow = (t: GameTip): boolean => {
    const g = gameById.get(t.gameId);
    return t.locked || t.level === "nicht_erfasst" || !g || isLocked(g, now);
  };

  // Schritt 1: offene Spiele auf den Favoriten zurück
  const base = tips.tips.map((t): GameTip => {
    if (lockedNow(t)) return { ...t, locked: true };
    return { ...t, ...favoriteTip(gameById.get(t.gameId)!, t.odds), deviation: false };
  });
  // Schritt 2: Abweichungen wie im Job, gesperrte Abweichungen zählen gegen das Budget
  const chosen = chooseDeviations(base, max);
  const out = base.map((t, i): GameTip => {
    const orig = tips.tips[i]!;
    if (lockedNow(orig)) return orig;
    const game = gameById.get(t.gameId)!;
    let next = t;
    if (chosen.has(t.gameId)) {
      next = {
        ...t,
        pickTeamId: t.pickTeamId === game.homeId ? game.awayId : game.homeId,
        pickProb: roundProb(1 - t.pickProb!),
        deviation: true,
      };
    }
    const firstPickTeamId = orig.firstPickTeamId ?? t.pickTeamId;
    return {
      ...next,
      firstPickTeamId,
      changedSinceFirst: firstPickTeamId !== null && next.pickTeamId !== null && next.pickTeamId !== firstPickTeamId,
    };
  });

  // Tiebreaker folgen dem getippten Team (D026), gesperrte bleiben
  const tipById = new Map(out.map((t, i) => [t.gameId, { tip: t, orig: tips.tips[i]! }]));
  const tiebreakers = tips.tiebreakers.map((tb) => {
    const entry = tipById.get(tb.gameId);
    const game = gameById.get(tb.gameId);
    if (!entry || !game || lockedNow(entry.orig)) return tb;
    return tiebreakerFor(game, entry.tip.odds, tb.slot, entry.tip);
  });

  return { ...tips, maxDeviations: max, tips: out, tiebreakers };
}

/**
 * Tippdatei, wie Tipps und Spiele sie zeigen. Offene Wochen rechnen für den gewählten Spieler neu, vergangene
 * Wochen zeigen die Datei des Hauptnutzers. Eine Funktion für beide Reiter, damit nie zwei Tipps erscheinen.
 */
export function shownTipsFor(
  tips: TipsFile | null,
  games: readonly Game[] | null | undefined,
  standings: StandingsFile | null,
  phase: WeekPhase,
  player: string | null,
  now: string,
): TipsFile | null {
  if (!tips || !games || !standings || phase === "vergangen") return tips;
  return tipsForPlayer(tips, games, standings, player, now);
}

/** shownTipsFor als Hook, neu gerechnet bei neuen Daten oder einem anderen Spieler. */
export function useShownTips(
  tips: TipsFile | null,
  games: readonly Game[] | null | undefined,
  standings: StandingsFile | null,
  phase: WeekPhase,
  player: string | null,
): TipsFile | null {
  return useMemo(
    () => shownTipsFor(tips, games, standings, phase, player, new Date().toISOString()),
    [tips, games, standings, phase, player],
  );
}
