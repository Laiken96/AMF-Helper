// Tipplogik Sprint 2. Reine Funktionen ohne Node APIs, nutzbar in Jobs und App.
// Regeln siehe sprints/sprint-02.md, D010, D023, D024, D025, D052. Seit D052 wählt die App keine Abweichungen
// mehr, der Vorschlag ist immer der Favorit. Eine Abweichung wählt der Nutzer selbst in der App (player.ts).
import { compareGames } from "./espn";
import type { Game, WeekFile } from "./schema";
import {
  TIPS_SCHEMA_VERSION,
  TipsFileSchema,
  type GameTip,
  type Odds,
  type StandingsFile,
  type TipsFile,
} from "./tips-schema";

/** Standardabweichung des Spielausgangs in Punkten (D024). */
export const SPREAD_SIGMA = 13.5;
export const LEVEL_KLAR = 0.75;
export const LEVEL_FAVORIT = 0.6;
/** Tiebreaker ohne Over/Under: Favorit 23, Aussenseiter 20. */
export const STANDARD_TIEBREAKER = { favorite: 23, underdog: 20 } as const;
/** Wochen der Regular Season. */
export const REGULAR_SEASON_WEEKS = 18;
/** Vorsprung des getippten Aussenseiters im Tiebreaker nach D026, gilt für die eigene Abweichung (D052). */
export const UPSET_MARGIN = 3;

export type TipLevel = GameTip["level"];
export type Tiebreaker = TipsFile["tiebreakers"][number];
export type TiebreakerSlot = Tiebreaker["slot"];

const NY_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });

/** Wochentag eines Kickoffs in America/New_York, z. B. "Thu" (D025). */
export function weekdayNewYork(kickoffUtc: string): string {
  return NY_WEEKDAY.format(new Date(kickoffUtc));
}

/**
 * Tiebreaker Spiele nach D025: spätestes Spiel am Donnerstag und spätestes am Montag in America/New_York.
 * Reihenfolge thursday vor monday, fehlende Tage fallen weg.
 */
export function tiebreakerGames(games: readonly Game[]): Array<{ slot: TiebreakerSlot; game: Game }> {
  // Verschobene und abgesagte Spiele scheiden aus, sonst fiele der Tiebreaker auf ein Spiel ohne Wertung.
  const sorted = games.filter((g) => g.status !== "postponed" && g.status !== "canceled").sort(compareGames);
  const out: Array<{ slot: TiebreakerSlot; game: Game }> = [];
  const days: Array<[TiebreakerSlot, string]> = [
    ["thursday", "Thu"],
    ["monday", "Mon"],
  ];
  for (const [slot, day] of days) {
    const onDay = sorted.filter((g) => weekdayNewYork(g.kickoffUtc) === day);
    const latest = onDay[onDay.length - 1];
    if (latest) out.push({ slot, game: latest });
  }
  return out;
}

/** Fehlerfunktion nach Abramowitz und Stegun 7.1.26, absoluter Fehler unter 1.5e-7. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Verteilungsfunktion der Standardnormalverteilung. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Siegwahrscheinlichkeit des Heimteams aus dem Spread aus Heimsicht: Phi(-spreadHome / 13.5). */
export function homeWinProbability(spreadHome: number): number {
  return normalCdf(-spreadHome / SPREAD_SIGMA);
}

/** Rundet auf 4 Stellen, damit die Datei bei gleicher Quote stabil bleibt. */
export function roundProb(p: number): number {
  return Math.round(p * 10_000) / 10_000;
}

/** Lage aus der Wahrscheinlichkeit des Favoriten, null heisst keine Quote. */
export function tipLevel(favoriteProb: number | null): TipLevel {
  if (favoriteProb === null) return "offen";
  if (favoriteProb >= LEVEL_KLAR) return "klar";
  if (favoriteProb >= LEVEL_FAVORIT) return "favorit";
  return "unklar";
}

/**
 * Rückstand auf Platz 1, nur Information seit D052. In Führung oder gleichauf mit der Spitze ergibt 0.
 * Wirft, wenn das eigene Kürzel fehlt.
 */
export function gapToTarget(standings: StandingsFile): number {
  const mine = standings.players.find((p) => p.id === standings.me);
  if (!mine) throw new Error(`Kürzel ${standings.me} fehlt in der Rangliste`);
  const top = Math.max(...standings.players.map((p) => p.points));
  return Math.max(0, top - mine.points);
}

/** Gesperrt ab Kickoff oder sobald das Spiel nicht mehr geplant ist (D023). */
export function isLocked(game: Pick<Game, "kickoffUtc" | "status">, now: string): boolean {
  return Date.parse(now) >= Date.parse(game.kickoffUtc) || game.status !== "scheduled";
}

/** Anbieter ohne Leerzeichen und in Kleinschreibung, ESPN liefert "Draft Kings" und "DraftKings". */
export function normalizeProvider(provider: string): string {
  return provider.replace(/\s+/g, "").toLowerCase();
}

export function sameOdds(a: Odds | null, b: Odds | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    normalizeProvider(a.provider) === normalizeProvider(b.provider) &&
    a.spreadHome === b.spreadHome &&
    a.overUnder === b.overUnder
  );
}

/**
 * Erste erfasste Quote eines Tipps (Linienbewegung, D050). Einmal gesetzt bleibt sie. Fehlt sie in einer
 * Datei aus Version 1, gilt die zuletzt gespeicherte Quote als beste Näherung, sonst die aktuelle.
 */
export function firstOddsOf(prev: GameTip | undefined, odds: Odds | null): Odds | null {
  if (prev?.firstOdds) return prev.firstOdds;
  return prev?.odds ?? odds;
}

/** Grundtipp ohne Abweichung: Favorit nach Quote, bei exakt 0.5 das Heimteam. */
export function favoriteTip(game: Game, odds: Odds | null): Pick<GameTip, "pHome" | "pickTeamId" | "pickProb" | "level"> {
  if (odds === null) return { pHome: null, pickTeamId: null, pickProb: null, level: "offen" };
  const pHome = roundProb(homeWinProbability(odds.spreadHome));
  const homePick = pHome >= 0.5;
  const pickProb = homePick ? pHome : roundProb(1 - pHome);
  return { pHome, pickTeamId: homePick ? game.homeId : game.awayId, pickProb, level: tipLevel(pickProb) };
}

/**
 * Resultatvorschlag aus Over/Under und Spread. Favorit = (OU + |spread|)/2, Aussenseiter = (OU minus |spread|)/2.
 * Ohne Over/Under 23 zu 20. Der Sieger folgt dem Tipp (D026): ist der Tipp eine Abweichung,
 * gewinnt der getippte Aussenseiter mit 3 Punkten Vorsprung bei gleichem Total.
 */
export function tiebreakerFor(
  game: Game,
  odds: Odds | null,
  slot: TiebreakerSlot,
  pick: { pickTeamId: string | null; deviation: boolean } = { pickTeamId: null, deviation: false },
): Tiebreaker {
  const homeFavorite = odds === null || odds.spreadHome <= 0;
  let fav: number = STANDARD_TIEBREAKER.favorite;
  let dog: number = STANDARD_TIEBREAKER.underdog;
  let basis: Tiebreaker["basis"] = "standard";
  if (odds !== null && odds.overUnder !== null) {
    const spread = Math.abs(odds.spreadHome);
    fav = Math.round((odds.overUnder + spread) / 2);
    dog = Math.max(0, Math.round((odds.overUnder - spread) / 2));
    // Gerundet darf der Favorit nicht gleichauf oder hinten liegen, auch bei Pick em nicht.
    if (fav <= dog) fav = dog + 1;
    basis = "quote";
  }
  let winnerHome = homeFavorite;
  if (pick.pickTeamId === game.homeId) winnerHome = true;
  else if (pick.pickTeamId === game.awayId) winnerHome = false;
  let winner = fav;
  let loser = dog;
  if (pick.deviation && pick.pickTeamId !== null) {
    const total = odds?.overUnder ?? STANDARD_TIEBREAKER.favorite + STANDARD_TIEBREAKER.underdog;
    winner = Math.round((total + UPSET_MARGIN) / 2);
    loser = Math.max(0, winner - UPSET_MARGIN);
  }
  return {
    gameId: game.id,
    slot,
    homePoints: winnerHome ? winner : loser,
    awayPoints: winnerHome ? loser : winner,
    basis,
  };
}

export interface BuildTipsInput {
  week: WeekFile;
  /** Quoten pro gameId aus parseOdds, fehlender Eintrag gilt als null. */
  odds: Readonly<Record<string, Odds | null>>;
  /** Rangliste, seit D052 ohne Einfluss auf die Tipps. Bleibt im Aufruf, damit der Job sie weiter prüft. */
  standings: StandingsFile;
  /** Bestehende Tippdatei derselben Woche oder null. */
  existing: TipsFile | null;
  now: string;
}

/**
 * Baut die Tippdatei der Woche und führt sie mit der bestehenden zusammen.
 * Gesperrte Tipps werden nie neu berechnet, der Grundtipp (firstPickTeamId) wird nie überschrieben.
 * Nicht gesperrte Spiele bekommen immer den Favoriten (D052). Eine früher gewählte Abweichung eines nicht
 * gesperrten Spiels fällt damit beim nächsten Lauf weg, gesperrte Abweichungen bleiben unverändert.
 */
export function buildTipsFile(input: BuildTipsInput): TipsFile {
  const { week, now } = input;
  const sameWeek =
    input.existing !== null &&
    input.existing.season === week.season &&
    input.existing.seasonType === week.seasonType &&
    input.existing.week === week.week;
  const prevById = new Map<string, GameTip>(sameWeek ? input.existing!.tips.map((t) => [t.gameId, t]) : []);
  const games = [...week.games].sort(compareGames);

  // Schritt 1: Favoritentipps, gesperrte aus der bestehenden Datei übernehmen.
  const carried = new Set<string>();
  const tips: GameTip[] = games.map((game) => {
    const prev = prevById.get(game.id);
    const locked = isLocked(game, now);
    if (locked && prev) {
      carried.add(game.id);
      return prev.locked ? prev : { ...prev, locked: true, lockedAt: now };
    }
    if (locked) {
      // Beim ersten Lauf schon gesperrt: nie getippt, nichts nachträglich berechnen.
      carried.add(game.id);
      return {
        gameId: game.id,
        kickoffUtc: game.kickoffUtc,
        odds: null,
        pHome: null,
        pickTeamId: null,
        pickProb: null,
        level: "nicht_erfasst",
        deviation: false,
        firstPickTeamId: null,
        firstOdds: null,
        changedSinceFirst: false,
        locked: true,
        lockedAt: now,
      };
    }
    let odds = input.odds[game.id] ?? null;
    // Kurzzeitig fehlende Quote vor Kickoff: letzte bekannte Quote behalten.
    if (odds === null && prev?.odds) odds = prev.odds;
    // Unveränderte Quote behält ihren Zeitstempel, damit die Datei nur bei echter Änderung neu geschrieben wird.
    if (odds !== null && prev?.odds && sameOdds(odds, prev.odds)) odds = prev.odds;
    return {
      gameId: game.id,
      kickoffUtc: game.kickoffUtc,
      odds,
      ...favoriteTip(game, odds),
      deviation: false,
      firstPickTeamId: prev?.firstPickTeamId ?? null,
      firstOdds: firstOddsOf(prev, odds),
      changedSinceFirst: false,
      locked: false,
      lockedAt: null,
    };
  });

  // Schritt 2: Grundtipp und Änderungsmarke. Keine Abweichungen mehr (D052).
  const merged = tips.map((tip): GameTip => {
    if (carried.has(tip.gameId)) return tip;
    // Grundtipp: erster Favoritentipp mit Quote, danach nie überschrieben (D023).
    const firstPickTeamId = tip.firstPickTeamId ?? tip.pickTeamId;
    return {
      ...tip,
      firstPickTeamId,
      changedSinceFirst: firstPickTeamId !== null && tip.pickTeamId !== null && tip.pickTeamId !== firstPickTeamId,
    };
  });

  // Tiebreaker nach D025. Gesperrt bleibt der bisherige Vorschlag.
  const tipById = new Map(merged.map((t) => [t.gameId, t]));
  const prevTbs = sameWeek ? input.existing!.tiebreakers : [];
  const tiebreakers: Tiebreaker[] = [];
  const lockedSlots = new Set<TiebreakerSlot>();
  // Ein schon gesperrter Tiebreaker bleibt, auch wenn sein Spiel danach verschoben oder unterbrochen wird.
  for (const prevTb of prevTbs) {
    if (tipById.get(prevTb.gameId)?.locked) {
      tiebreakers.push(prevTb);
      lockedSlots.add(prevTb.slot);
    }
  }
  for (const { slot, game } of tiebreakerGames(games)) {
    if (lockedSlots.has(slot)) continue;
    const tip = tipById.get(game.id)!;
    // Nie erfasste Spiele bekommen keinen Tiebreaker.
    if (tip.level === "nicht_erfasst") continue;
    const prevTb = prevTbs.find((t) => t.slot === slot && t.gameId === game.id);
    tiebreakers.push(tip.locked && prevTb ? prevTb : tiebreakerFor(game, tip.odds, slot, tip));
  }
  tiebreakers.sort((a, b) => (a.slot === b.slot ? 0 : a.slot === "thursday" ? -1 : 1));

  return TipsFileSchema.parse({
    schemaVersion: TIPS_SCHEMA_VERSION,
    season: week.season,
    seasonType: week.seasonType,
    week: week.week,
    updatedAt: now,
    // Feld bleibt im Datenvertrag (Regel 3), seit D052 immer 0.
    maxDeviations: 0,
    tips: merged,
    tiebreakers,
  });
}

/** Vergleicht zwei Tippdateien ohne updatedAt. */
export function sameTipsContent(a: TipsFile, b: TipsFile): boolean {
  const strip = (f: TipsFile) => JSON.stringify({ ...f, updatedAt: "" });
  return strip(a) === strip(b);
}
