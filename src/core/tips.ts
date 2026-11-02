// Tipplogik Sprint 2. Reine Funktionen ohne Node APIs, nutzbar in Jobs und App.
// Regeln siehe sprints/sprint-02.md, D010, D023, D024, D025, D026.
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
/** Wochen der Regular Season und Länge des Saisonendes nach D026. */
export const REGULAR_SEASON_WEEKS = 18;
export const LATE_SEASON_WEEKS = 3;
/** Vorsprung des getippten Aussenseiters im Tiebreaker nach D026. */
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
  const sorted = [...games].sort(compareGames);
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
 * Rückstand auf den Spieler direkt vor dem eigenen Kürzel (Ziel nach D022, D026).
 * Ziel ist der Spieler mit den wenigsten Punkten über den eigenen, bei Gleichstand der erste in der Liste.
 * In Führung oder gleichauf mit der Spitze ergibt 0. Wirft, wenn das Kürzel fehlt.
 */
export function gapToTarget(standings: StandingsFile): number {
  const mine = standings.players.find((p) => p.id === standings.me);
  if (!mine) throw new Error(`Kürzel ${standings.me} fehlt in der Rangliste`);
  let target: number | null = null;
  for (const p of standings.players) {
    if (p.id === mine.id || p.points <= mine.points) continue;
    if (target === null || p.points < target) target = p.points;
  }
  return target === null ? 0 : target - mine.points;
}

/** Verbleibende Regular Season Wochen inklusive der aktuellen, mindestens 1. Postseason zählt als 1. */
export function remainingWeeks(seasonType: number, week: number): number {
  if (seasonType === 3) return 1;
  return Math.max(1, REGULAR_SEASON_WEEKS - week + 1);
}

/** Erlaubte Abweichungen nach D026 aus dem Rückstand pro Restwoche. */
export function maxDeviations(gap: number, seasonType: number, week: number): number {
  if (gap <= 0) return 0;
  const remaining = remainingWeeks(seasonType, week);
  const late = seasonType === 3 || remaining <= LATE_SEASON_WEEKS;
  if (late && gap > 2) return 3;
  const perWeek = gap / remaining;
  if (perWeek <= 1) return 0;
  if (perWeek <= 2) return 1;
  return 2;
}

/** Gesperrt ab Kickoff oder sobald das Spiel nicht mehr geplant ist (D023). */
export function isLocked(game: Pick<Game, "kickoffUtc" | "status">, now: string): boolean {
  return Date.parse(now) >= Date.parse(game.kickoffUtc) || game.status !== "scheduled";
}

function sameOdds(a: Odds | null, b: Odds | null): boolean {
  if (a === null || b === null) return a === b;
  return a.provider === b.provider && a.spreadHome === b.spreadHome && a.overUnder === b.overUnder;
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
 * Wählt die Abweichungen: Spiele mit Lage unklar, nicht gesperrt, aufsteigend nach Favoritenwahrscheinlichkeit.
 * Bereits gesperrte Abweichungen zählen gegen das Wochenbudget. Liefert die gameIds.
 */
export function chooseDeviations(tips: readonly GameTip[], max: number): Set<string> {
  const used = tips.filter((t) => t.locked && t.deviation).length;
  const budget = Math.max(0, max - used);
  const candidates = tips
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => !t.locked && t.level === "unklar" && t.pickProb !== null)
    .sort((a, b) => a.t.pickProb! - b.t.pickProb! || a.index - b.index);
  return new Set(candidates.slice(0, budget).map(({ t }) => t.gameId));
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
    // Gerundet darf der Favorit nicht gleichauf oder hinten liegen.
    if (spread > 0 && fav <= dog) fav = dog + 1;
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
  standings: StandingsFile;
  /** Bestehende Tippdatei derselben Woche oder null. */
  existing: TipsFile | null;
  now: string;
}

/**
 * Baut die Tippdatei der Woche und führt sie mit der bestehenden zusammen.
 * Gesperrte Tipps werden nie neu berechnet, der Grundtipp (firstPickTeamId) wird nie überschrieben.
 */
export function buildTipsFile(input: BuildTipsInput): TipsFile {
  const { week, now } = input;
  const max = maxDeviations(gapToTarget(input.standings), week.seasonType, week.week);
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
      changedSinceFirst: false,
      locked,
      lockedAt: locked ? now : null,
    };
  });

  // Schritt 2: Abweichungen nur bei nicht gesperrten Spielen, dann Grundtipp und Änderungsmarke.
  const deviations = chooseDeviations(tips, max);
  const gamesById = new Map(games.map((g) => [g.id, g]));
  const merged = tips.map((tip): GameTip => {
    if (carried.has(tip.gameId)) return tip;
    const game = gamesById.get(tip.gameId)!;
    let next = tip;
    if (deviations.has(tip.gameId)) {
      const homePick = tip.pickTeamId === game.homeId;
      next = {
        ...tip,
        pickTeamId: homePick ? game.awayId : game.homeId,
        pickProb: roundProb(1 - tip.pickProb!),
        deviation: true,
      };
    }
    // Grundtipp: erster berechnete Tipp mit Quote, danach nie überschrieben (D023).
    const firstPickTeamId = next.firstPickTeamId ?? next.pickTeamId;
    return {
      ...next,
      firstPickTeamId,
      changedSinceFirst: firstPickTeamId !== null && next.pickTeamId !== null && next.pickTeamId !== firstPickTeamId,
    };
  });

  // Tiebreaker nach D025. Gesperrt bleibt der bisherige Vorschlag.
  const tipById = new Map(merged.map((t) => [t.gameId, t]));
  const prevTbs = sameWeek ? input.existing!.tiebreakers : [];
  const tiebreakers = tiebreakerGames(games).map(({ slot, game }) => {
    const tip = tipById.get(game.id)!;
    const prevTb = prevTbs.find((t) => t.slot === slot && t.gameId === game.id);
    return tip.locked && prevTb ? prevTb : tiebreakerFor(game, tip.odds, slot, tip);
  });

  return TipsFileSchema.parse({
    schemaVersion: TIPS_SCHEMA_VERSION,
    season: week.season,
    seasonType: week.seasonType,
    week: week.week,
    updatedAt: now,
    maxDeviations: max,
    tips: merged,
    tiebreakers,
  });
}

/** Vergleicht zwei Tippdateien ohne updatedAt. */
export function sameTipsContent(a: TipsFile, b: TipsFile): boolean {
  const strip = (f: TipsFile) => JSON.stringify({ ...f, updatedAt: "" });
  return strip(a) === strip(b);
}
