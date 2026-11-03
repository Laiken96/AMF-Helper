// Kalibrierung der Gegner für die Simulation Platz 1 (D050, Offen Punkt aus D051). Reine Funktionen ohne IO.
// Zwei Grössen pro Spieler:
// Tippquote (pickRate): Anteil abgegebener Tipps. Geschätzt aus dem Saisontotal gegen die erwarteten Treffer
// eines Spielers, der jedes Spiel tippt. Die Spiele vor dem Start der App sind nicht bekannt, dafür gilt eine
// angenommene Anzahl Spiele pro Woche.
// Aussenseiterquote (upsetRate): Anteil der Tipps auf den Aussenseiter. Aus dem Total allein nicht von der
// Tippquote zu trennen, darum nur aus Wochen mit gemeldeten Wochenpunkten und bekanntem Ausgang jedes Spiels
// (Favorit gewann oder nicht). Der Wert wird zur Annahme DEFAULT_UPSET_RATE hin gestaucht, solange wenig
// Spiele vorliegen. Ohne solche Wochen bleibt die Annahme.
// Das Modell entspricht simulate.ts: Aussenseiter Tipps verteilen sich nach der Siegchance des Aussenseiters.
import type { StandingsHistory } from "./review-schema";
import { DEFAULT_PROB_POOL, DEFAULT_UPSET_RATE, type SimPlayer } from "./simulate";
import { groupWeekRows } from "./standings";

/** Spiele pro Woche der Regular Season, wenn keine Datei der Woche vorliegt (272 Spiele auf 18 Wochen). */
export const ASSUMED_GAMES_PER_WEEK = 272 / 18;
/** Gewicht der Annahme in Spielen. Erst ab deutlich mehr eigenen Spielen setzt sich der gemessene Wert durch. */
export const PRIOR_GAMES = 48;
/** Obergrenze der geschätzten Aussenseiterquote. */
export const MAX_UPSET_RATE = 0.5;

/** Ein Spiel einer vollständig ausgewerteten Woche. */
export interface CalibrationGame {
  favProb: number; // Siegchance des Favoriten laut Markt, ab 0.5
  outcome: "fav" | "dog" | "tie";
}

export interface CalibrationWeek {
  seasonType: number;
  week: number;
  games: readonly CalibrationGame[];
}

export interface CalibrationInput {
  season: number;
  players: readonly { id: string; points: number }[];
  /** Mögliche Spiele der Saison bis zum Stand der Rangliste. */
  possibleGames: number;
  /** Favoritenwahrscheinlichkeiten als typische Verteilung, z. B. favoriteProbPool. */
  probPool?: readonly number[];
  history?: StandingsHistory;
  weeks?: readonly CalibrationWeek[];
  prior?: number;
}

export interface PlayerCalibration {
  id: string;
  points: number;
  pickRate: number;
  pickRateFromData: boolean;
  upsetRate: number;
  /** true, wenn gemeldete Wochen in den Wert eingeflossen sind. */
  upsetFromData: boolean;
  /** Spiele aus gemeldeten Wochen, die in die Aussenseiterquote eingeflossen sind. */
  upsetGames: number;
  /** Ungestauchte Schätzung aus den Wochen, null ohne Daten. */
  upsetRaw: number | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const fav = (p: number) => clamp(Math.max(p, 1 - p), 0.5, 1);

/** Gewichte für Aussenseiter Tipps wie in simulate.ts: proportional zur Siegchance des Aussenseiters, Mittel 1. */
export function dogWeights(probs: readonly number[]): number[] {
  if (probs.length === 0) return [];
  const dogs = probs.map((p) => 1 - fav(p));
  const mean = dogs.reduce((s, d) => s + d, 0) / dogs.length;
  return dogs.map((d) => (mean > 0 ? d / mean : 0));
}

/**
 * Erwartete Treffer pro abgegebenem Tipp bei Aussenseiterquote u, über eine typische Woche (Pool).
 * h(u) = mittlere Favoritenchance minus u mal Mittel von w (2p minus 1).
 */
export function expectedHitRate(pool: readonly number[], u: number): number {
  const probs = (pool.length > 0 ? pool : DEFAULT_PROB_POOL).map(fav);
  const w = dogWeights(probs);
  let base = 0;
  let cost = 0;
  for (let g = 0; g < probs.length; g++) {
    base += probs[g]!;
    cost += w[g]! * (2 * probs[g]! - 1);
  }
  return (base - u * cost) / probs.length;
}

/** Summen einer Woche: Favoritensiege F und Kostenterm D, erwartete Punkte E = r (F minus u D). */
function weekTerms(week: CalibrationWeek): { F: number; D: number; n: number } {
  const w = dogWeights(week.games.map((g) => g.favProb));
  let F = 0;
  let D = 0;
  week.games.forEach((g, i) => {
    const f = g.outcome === "fav" ? 1 : 0;
    const d = g.outcome === "dog" ? 1 : 0;
    F += f;
    D += w[i]! * (f - d);
  });
  return { F, D, n: week.games.length };
}

/** Schätzt Tippquote und Aussenseiterquote pro Spieler. */
export function calibratePlayers(input: CalibrationInput): PlayerCalibration[] {
  const prior = input.prior ?? DEFAULT_UPSET_RATE;
  const pool = input.probPool && input.probPool.length > 0 ? input.probPool : DEFAULT_PROB_POOL;
  const weekly = (input.weeks ?? [])
    .filter((w) => w.games.length > 0)
    .map((w) => {
      const rows = input.history ? groupWeekRows(input.history, input.season, w.seasonType, w.week) : null;
      return { terms: weekTerms(w), rows };
    })
    .filter((x) => x.rows !== null);

  return input.players.map((p) => {
    const own = weekly
      .map((x) => ({ terms: x.terms, pts: x.rows!.find((r) => r.id === p.id)?.week ?? null }))
      .filter((x): x is { terms: { F: number; D: number; n: number }; pts: number } => x.pts !== null);
    const nGames = own.reduce((s, x) => s + x.terms.n, 0);
    let u = prior;
    let r = 1;
    let raw: number | null = null;
    // Tippquote und Aussenseiterquote hängen voneinander ab, wenige Runden genügen
    for (let iter = 0; iter < 4; iter++) {
      const h = expectedHitRate(pool, u);
      r = input.possibleGames > 0 && h > 0 ? clamp(p.points / (input.possibleGames * h), 0, 1) : 1;
      if (own.length === 0 || r <= 0) break;
      const num = own.reduce((s, x) => s + x.terms.F - x.pts / r, 0);
      const den = own.reduce((s, x) => s + x.terms.D, 0);
      if (den <= 0) break;
      raw = clamp(num / den, 0, MAX_UPSET_RATE);
      u = (nGames * raw + PRIOR_GAMES * prior) / (nGames + PRIOR_GAMES);
    }
    return {
      id: p.id,
      points: p.points,
      pickRate: round4(r),
      pickRateFromData: input.possibleGames > 0,
      upsetRate: round4(clamp(u, 0, MAX_UPSET_RATE)),
      upsetFromData: raw !== null,
      upsetGames: raw !== null ? nGames : 0,
      upsetRaw: raw === null ? null : round4(raw),
    };
  });
}

/**
 * Mögliche Spiele bis einschliesslich asOfWeek. Bekannte Wochen zählen mit ihrer Spielzahl, alle übrigen mit
 * ASSUMED_GAMES_PER_WEEK. Liefert auch, wie viele Wochen angenommen sind.
 */
export function possibleGamesThrough(asOfWeek: number, knownCounts: ReadonlyMap<number, number>): { games: number; assumedWeeks: number } {
  let games = 0;
  let assumedWeeks = 0;
  for (let w = 1; w <= asOfWeek; w++) {
    const c = knownCounts.get(w);
    if (c !== undefined) games += c;
    else {
      games += ASSUMED_GAMES_PER_WEEK;
      assumedWeeks++;
    }
  }
  return { games: Math.round(games), assumedWeeks };
}

/** Spieler für simulateFirstPlace. Der eigene Spieler tippt künftig jedes Spiel (Push vor Tippschluss, D022). */
/**
 * Spieler für die Simulation. Tippquote "geschaetzt": alle, auch der eigene Spieler, mit der aus den Punkten
 * geschätzten Tippquote. "voll": alle tippen jedes Spiel. So bekommt nie nur der eigene Spieler 100 Prozent
 * (Review D052). Die Aussenseiterquote gilt nur für Gegner, der eigene Spieler weicht k mal pro Woche ab.
 */
export type PickRateMode = "geschaetzt" | "voll";

export function simPlayers(cal: readonly PlayerCalibration[], me: string, mode: PickRateMode = "geschaetzt"): SimPlayer[] {
  return cal.map((c) => {
    const pickRate = mode === "voll" ? 1 : c.pickRate;
    return c.id === me
      ? { id: c.id, points: c.points, pickRate }
      : { id: c.id, points: c.points, pickRate, upsetRate: c.upsetRate };
  });
}

/** Verbleibende Regular Season Wochen nach dem Stand asOfWeek (Woche 18 ist die letzte). */
export function remainingRegularWeeks(seasonType: number, asOfWeek: number): number {
  if (seasonType !== 2) return 0;
  return Math.max(0, 18 - asOfWeek);
}

/**
 * Woche für die Kalibrierung aus Bilanz und Tippdatei. Nur vollständige Wochen, in denen jedes Spiel eine Quote
 * und einen Grundtipp (Favorit) hat, sonst null. Die Gegner können jedes Spiel tippen, darum zählt die ganze Woche.
 */
export function calibrationWeekFrom(
  review: { seasonType: number; week: number; complete: boolean; games: readonly { gameId: string; final: boolean; winnerTeamId: string | null }[] },
  tips: { tips: readonly { gameId: string; pHome: number | null; firstPickTeamId: string | null }[] } | null,
): CalibrationWeek | null {
  if (!review.complete || !tips || review.games.length === 0) return null;
  const byId = new Map(tips.tips.map((t) => [t.gameId, t]));
  const games: CalibrationGame[] = [];
  for (const g of review.games) {
    const t = byId.get(g.gameId);
    if (!g.final || !t || t.pHome === null || t.firstPickTeamId === null) return null;
    const outcome = g.winnerTeamId === null ? "tie" : g.winnerTeamId === t.firstPickTeamId ? "fav" : "dog";
    games.push({ favProb: fav(t.pHome), outcome });
  }
  return { seasonType: review.seasonType, week: review.week, games };
}
