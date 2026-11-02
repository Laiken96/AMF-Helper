// Aufbau der Simulation Platz 1 aus den Saisondaten (D050, D051). Reine Funktion, nutzbar in App und Skripten.
// Verbindet Kalibrierung (calibrate.ts) und Simulation (simulate.ts). Die App ändert damit keine Regel,
// das Ergebnis ist Entscheidungsgrundlage für D026 und D028.
import {
  calibratePlayers,
  calibrationWeekFrom,
  possibleGamesThrough,
  remainingRegularWeeks,
  simPlayers,
  type CalibrationWeek,
  type PlayerCalibration,
} from "./calibrate";
import type { ReviewFile, StandingsHistory } from "./review-schema";
import { favoriteProbPool } from "./season";
import type { SimInput } from "./simulate";
import type { StandingsFile, TipsFile } from "./tips-schema";

export interface SimSetupInput {
  season: number;
  standings: StandingsFile;
  history: StandingsHistory;
  reviews: readonly ReviewFile[];
  tips: readonly TipsFile[];
  /** Spieler, für den gerechnet wird. Ohne Treffer in der Rangliste gilt standings.me. */
  me?: string | null;
  /** Spielzahl bekannter Wochen der Regular Season, z. B. aus den Wochendateien. */
  weekGameCounts?: ReadonlyMap<number, number>;
  runs?: number;
  seed?: number;
}

export interface SimSetup {
  me: string;
  asOfWeek: number;
  seasonType: number;
  remainingWeeks: number;
  possibleGames: number;
  /** Wochen bis zum Stand ohne bekannte Spielzahl, dort gilt die Annahme pro Woche. */
  assumedWeeks: number;
  calibrationWeeks: number;
  players: PlayerCalibration[];
  input: SimInput;
}

/** null, wenn die Rangliste fehlt, zu einer anderen Saison gehört oder weniger als zwei Spieler hat. */
export function buildSimSetup(src: SimSetupInput): SimSetup | null {
  const { standings, history, season } = src;
  if (standings.season !== undefined && standings.season !== season) return null;
  if (standings.players.length < 2) return null;
  const me = src.me && standings.players.some((p) => p.id === src.me) ? src.me : standings.me;
  if (!standings.players.some((p) => p.id === me)) return null;

  const asOfWeek = standings.asOfWeek;
  // Typ des Stands aus dem Verlauf, sonst Regular Season
  const entry = history.entries
    .filter((e) => e.season === season && e.week === asOfWeek)
    .sort((a, b) => b.seasonType - a.seasonType)[0];
  const seasonType = entry?.seasonType ?? 2;

  const tips = src.tips.filter((t) => t.season === season);
  const reviews = src.reviews.filter((r) => r.season === season);
  const counts = new Map(src.weekGameCounts ?? []);
  for (const r of reviews) if (r.seasonType === 2 && !counts.has(r.week)) counts.set(r.week, r.games.length);
  const possible = seasonType === 2 ? possibleGamesThrough(asOfWeek, counts) : possibleGamesThrough(18, counts);

  const tipsByKey = new Map(tips.map((t) => [`${t.seasonType}-${t.week}`, t]));
  const calWeeks: CalibrationWeek[] = [];
  for (const r of reviews) {
    const w = calibrationWeekFrom(r, tipsByKey.get(`${r.seasonType}-${r.week}`) ?? null);
    if (w) calWeeks.push(w);
  }
  const probPool = favoriteProbPool(tips);
  const players = calibratePlayers({
    season,
    players: standings.players,
    possibleGames: possible.games,
    probPool,
    history,
    weeks: calWeeks,
  });

  const remainingWeeks = remainingRegularWeeks(seasonType, asOfWeek);
  // Bekannte Quoten der kommenden Wochen, in Reihenfolge ab der Woche nach dem Stand
  const knownWeeks = tips
    .filter((t) => t.seasonType === 2 && t.week > asOfWeek)
    .sort((a, b) => a.week - b.week)
    .filter((t, i) => t.week === asOfWeek + 1 + i)
    .map((t) => favoriteProbPool([t]))
    .filter((w) => w.length > 0);

  return {
    me,
    asOfWeek,
    seasonType,
    remainingWeeks,
    possibleGames: possible.games,
    assumedWeeks: possible.assumedWeeks,
    calibrationWeeks: calWeeks.length,
    players,
    input: {
      players: simPlayers(players, me),
      me,
      remainingWeeks,
      knownWeeks,
      probPool: probPool.length > 0 ? probPool : undefined,
      runs: src.runs ?? 5000,
      seed: src.seed ?? 1,
    },
  };
}
