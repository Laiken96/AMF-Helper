// Saisonauswertung (D050): reine Funktion ohne IO, nutzbar in App und Jobs. Grundlage für einen neuen Entscheid
// zu D026 und D028. Eingabe sind alle Bilanz und Tippdateien einer Saison, Dateien anderer Saisons werden ignoriert.
import type { GameReview, ReviewFile } from "./review-schema";
import type { GameTip, TipsFile } from "./tips-schema";

/** Wahrscheinlichkeitsbänder des Favoriten. Das letzte Band schliesst 100 Prozent ein. */
export const PROB_BANDS = [
  { id: "50-60", from: 0.5, to: 0.6 },
  { id: "60-70", from: 0.6, to: 0.7 },
  { id: "70-80", from: 0.7, to: 0.8 },
  { id: "80+", from: 0.8, to: 1.0001 },
] as const;
export type BandId = (typeof PROB_BANDS)[number]["id"];

export interface BrierScore {
  n: number; // gewertete Spiele
  value: number | null; // null ohne Spiel
}

export interface BandRow {
  band: BandId;
  games: number; // gewertete Spiele ohne Unentschieden
  hits: number; // Favorit gewann
  hitRate: number | null;
  expectedRate: number | null; // mittlere Wahrscheinlichkeit des Favoriten laut Markt
  diff: number | null; // hitRate minus expectedRate
}

export interface SeasonWeekRow {
  seasonType: number;
  week: number;
  complete: boolean;
  appPoints: number;
  favoritePoints: number;
  deviationNet: number;
}

export interface SeasonSummary {
  season: number;
  weeks: number; // Wochen mit Bilanz
  completeWeeks: number;
  games: number; // finale Spiele mit App Tipp
  appPoints: number;
  favoritePoints: number; // reiner Favoritentipp auf dieselben Spiele
  appMinusFavorite: number;
  deviations: {
    count: number; // Abweichungen mit Tipp
    scored: number; // davon final
    hits: number; // getippter Aussenseiter gewann
    net: number; // Summe deviationEffect, gleich appPoints minus favoritePoints
    expectedNet: number | null; // Summe 2p minus 1 mit p Wahrscheinlichkeit des getippten Aussenseiters
    luck: number | null; // net minus expectedNet
  };
  bands: BandRow[];
  brier: {
    market: BrierScore; // alle gewerteten Spiele mit Quote
    marketOnOpinions: BrierScore; // nur Spiele mit KI Meinung, gewichtet aus opinionCompare
    ai: BrierScore;
    fpi: BrierScore; // nur mit fpiPickProb
    marketOnFpi: BrierScore; // Markt auf denselben Spielen wie fpi
  };
  tiebreaker: { count: number; meanDiff: number | null };
  weekRows: SeasonWeekRow[];
}

export interface SeasonInput {
  season: number;
  reviews: readonly ReviewFile[];
  tips: readonly TipsFile[];
  /**
   * Optional: FPI Siegwahrscheinlichkeit des getippten Teams (pickTeamId) eines Tipps, null ohne Wert.
   * Das Feld liefert der FPI Schattenvergleich, die Auswertung liest es nur über diese Funktion.
   */
  fpiPickProb?: (tip: GameTip) => number | null;
}

const key = (k: { seasonType: number; week: number }) => `${k.seasonType}-${k.week}`;
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const rate = (a: number, n: number) => (n > 0 ? round4(a / n) : null);

/** Favorit hat gewonnen? null bei offenem Spiel, Unentschieden oder ohne Tipp. */
export function favoriteWon(r: GameReview): boolean | null {
  if (!r.final || r.pickTeamId === null || r.winnerTeamId === null) return null;
  const pickWon = r.winnerTeamId === r.pickTeamId;
  return r.deviation ? !pickWon : pickWon;
}

/** Punkt für den reinen Favoritentipp. Unentschieden zählt als falsch wie in der Bilanz. */
function favoritePoint(r: GameReview): number {
  return favoriteWon(r) === true ? 1 : 0;
}

export function bandOf(favoriteProb: number): BandId | null {
  for (const b of PROB_BANDS) if (favoriteProb >= b.from && favoriteProb < b.to) return b.id;
  return null;
}

export function buildSeasonSummary(input: SeasonInput): SeasonSummary {
  const reviews = input.reviews
    .filter((r) => r.season === input.season)
    .sort((a, b) => a.seasonType - b.seasonType || a.week - b.week);
  const tipsByWeek = new Map<string, Map<string, GameTip>>();
  for (const t of input.tips) {
    if (t.season !== input.season) continue;
    tipsByWeek.set(key(t), new Map(t.tips.map((g) => [g.gameId, g])));
  }

  let games = 0;
  let appPoints = 0;
  let favoritePoints = 0;
  const dev = { count: 0, scored: 0, hits: 0, net: 0, expected: 0, expectedN: 0 };
  const bandAcc = new Map<BandId, { games: number; hits: number; probSum: number }>();
  const market = { n: 0, sq: 0 };
  const fpi = { n: 0, sq: 0 };
  const marketFpi = { n: 0, sq: 0 };
  const opin = { mN: 0, mSum: 0, aN: 0, aSum: 0 };
  const tb = { n: 0, sum: 0 };
  const weekRows: SeasonWeekRow[] = [];

  for (const review of reviews) {
    const tips = tipsByWeek.get(key(review)) ?? new Map<string, GameTip>();
    let wApp = 0;
    let wFav = 0;
    for (const r of review.games) {
      if (r.pickTeamId === null) continue;
      if (r.deviation) dev.count++;
      if (!r.final) continue;
      games++;
      const app = r.correct === true ? 1 : 0;
      const fav = favoritePoint(r);
      appPoints += app;
      favoritePoints += fav;
      wApp += app;
      wFav += fav;

      const tip = tips.get(r.gameId);
      const pPick = tip?.pickProb ?? null;
      if (r.deviation && r.deviationEffect !== null) {
        dev.scored++;
        dev.net += r.deviationEffect;
        if (r.deviationEffect === 1) dev.hits++;
        if (pPick !== null) {
          dev.expected += 2 * pPick - 1;
          dev.expectedN++;
        }
      }
      if (r.winnerTeamId === null) continue; // Unentschieden zählt weder in Bändern noch im Brier Score
      const pickHit = r.winnerTeamId === r.pickTeamId ? 1 : 0;
      if (pPick !== null) {
        market.n++;
        market.sq += (pPick - pickHit) ** 2;
        const pFav = r.deviation ? 1 - pPick : pPick;
        const band = bandOf(pFav);
        if (band !== null) {
          const acc = bandAcc.get(band) ?? { games: 0, hits: 0, probSum: 0 };
          acc.games++;
          acc.hits += favoriteWon(r) ? 1 : 0;
          acc.probSum += pFav;
          bandAcc.set(band, acc);
        }
      }
      const q = tip && input.fpiPickProb ? input.fpiPickProb(tip) : null;
      if (q !== null && q >= 0 && q <= 1) {
        fpi.n++;
        fpi.sq += (q - pickHit) ** 2;
        if (pPick !== null) {
          marketFpi.n++;
          marketFpi.sq += (pPick - pickHit) ** 2;
        }
      }
    }
    const c = review.opinionCompare;
    if (c && c.scored > 0) {
      if (c.aiBrier !== null) {
        opin.aN += c.scored;
        opin.aSum += c.aiBrier * c.scored;
      }
      if (c.marketBrier !== null) {
        opin.mN += c.scored;
        opin.mSum += c.marketBrier * c.scored;
      }
    }
    for (const t of review.tiebreakers) {
      if (t.diff === null) continue;
      tb.n++;
      tb.sum += t.diff;
    }
    weekRows.push({
      seasonType: review.seasonType,
      week: review.week,
      complete: review.complete,
      appPoints: wApp,
      favoritePoints: wFav,
      deviationNet: wApp - wFav,
    });
  }

  const expectedNet = dev.expectedN > 0 ? round4(dev.expected) : null;
  return {
    season: input.season,
    weeks: reviews.length,
    completeWeeks: reviews.filter((r) => r.complete).length,
    games,
    appPoints,
    favoritePoints,
    appMinusFavorite: appPoints - favoritePoints,
    deviations: {
      count: dev.count,
      scored: dev.scored,
      hits: dev.hits,
      net: dev.net,
      expectedNet,
      luck: expectedNet === null ? null : round4(dev.net - expectedNet),
    },
    bands: PROB_BANDS.map((b) => {
      const acc = bandAcc.get(b.id);
      const n = acc?.games ?? 0;
      const hitRate = rate(acc?.hits ?? 0, n);
      const expectedRate = rate(acc?.probSum ?? 0, n);
      return {
        band: b.id,
        games: n,
        hits: acc?.hits ?? 0,
        hitRate,
        expectedRate,
        diff: hitRate === null || expectedRate === null ? null : round4(hitRate - expectedRate),
      };
    }),
    brier: {
      market: { n: market.n, value: rate(market.sq, market.n) },
      marketOnOpinions: { n: opin.mN, value: rate(opin.mSum, opin.mN) },
      ai: { n: opin.aN, value: rate(opin.aSum, opin.aN) },
      fpi: { n: fpi.n, value: rate(fpi.sq, fpi.n) },
      marketOnFpi: { n: marketFpi.n, value: rate(marketFpi.sq, marketFpi.n) },
    },
    tiebreaker: { count: tb.n, meanDiff: tb.n > 0 ? round4(tb.sum / tb.n) : null },
    weekRows,
  };
}

/** Favoritenwahrscheinlichkeiten aller Tipps mit Quote, z. B. als typische Verteilung für die Simulation. */
export function favoriteProbPool(tips: readonly TipsFile[]): number[] {
  const out: number[] = [];
  for (const f of tips) {
    for (const t of f.tips) {
      if (t.pickProb === null) continue;
      out.push(t.deviation ? 1 - t.pickProb : t.pickProb);
    }
  }
  return out.map((p) => Math.max(p, 1 - p));
}

/**
 * FPI Siegwahrscheinlichkeit des getippten Teams aus den FPI Dateien (data/fpi), für fpiPickProb.
 * null, wenn das Spiel fehlt oder das getippte Team weder Heim noch Gast ist.
 */
export function fpiPickProbLookup(
  files: readonly { games: readonly { gameId: string; homeId: string; awayId: string; pHome: number; pAway: number }[] }[],
): (tip: GameTip) => number | null {
  const byId = new Map(files.flatMap((f) => f.games.map((g) => [g.gameId, g] as const)));
  return (tip) => {
    const g = byId.get(tip.gameId);
    if (!g || tip.pickTeamId === null) return null;
    if (tip.pickTeamId === g.homeId) return g.pHome;
    if (tip.pickTeamId === g.awayId) return g.pAway;
    return null;
  };
}
