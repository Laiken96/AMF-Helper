// Tipplogik Sprint 2. Reine Funktionen ohne Node APIs, nutzbar in Jobs und App.
// Regeln siehe sprints/sprint-02.md, D010, D021, D023, D024.
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
/** Ab dieser Woche der Regular Season gilt Saisonende für D021. */
export const LATE_SEASON_WEEK = 15;

export type TipLevel = GameTip["level"];
export type Tiebreaker = NonNullable<TipsFile["tiebreaker"]>;

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

/** Rückstand des eigenen Kürzels auf Platz 1. Wirft, wenn das Kürzel fehlt. */
export function deficitToLeader(standings: StandingsFile): number {
  const mine = standings.players.find((p) => p.id === standings.me);
  if (!mine) throw new Error(`Kürzel ${standings.me} fehlt in der Rangliste`);
  const top = Math.max(...standings.players.map((p) => p.points));
  return Math.max(0, top - mine.points);
}

/** Erlaubte Abweichungen nach D021. Postseason zählt wie Saisonende. */
export function maxDeviations(deficit: number, seasonType: number, week: number): number {
  if (deficit <= 0) return 0;
  if (deficit <= 2) return 1;
  const late = seasonType === 3 || (seasonType === 2 && week >= LATE_SEASON_WEEK);
  return late ? 3 : 2;
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

/** Resultatvorschlag aus Over/Under und Spread. Favorit = (OU + |spread|)/2, Aussenseiter = (OU minus |spread|)/2. */
export function tiebreakerFor(game: Game, odds: Odds | null): Tiebreaker {
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
  return {
    gameId: game.id,
    homePoints: homeFavorite ? fav : dog,
    awayPoints: homeFavorite ? dog : fav,
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
  const max = maxDeviations(deficitToLeader(input.standings), week.seasonType, week.week);
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

  // Tiebreaker: erstes Spiel nach Kickoff. Gesperrt bleibt der bisherige Vorschlag.
  let tiebreaker: Tiebreaker | null = null;
  const first = games[0];
  if (first) {
    const firstTip = merged[0]!;
    const prevTb = sameWeek ? input.existing!.tiebreaker : null;
    tiebreaker = firstTip.locked && prevTb?.gameId === first.id ? prevTb : tiebreakerFor(first, firstTip.odds);
  }

  return TipsFileSchema.parse({
    schemaVersion: TIPS_SCHEMA_VERSION,
    season: week.season,
    seasonType: week.seasonType,
    week: week.week,
    updatedAt: now,
    maxDeviations: max,
    tips: merged,
    tiebreaker,
  });
}

/** Vergleicht zwei Tippdateien ohne updatedAt. */
export function sameTipsContent(a: TipsFile, b: TipsFile): boolean {
  const strip = (f: TipsFile) => JSON.stringify({ ...f, updatedAt: "" });
  return strip(a) === strip(b);
}
