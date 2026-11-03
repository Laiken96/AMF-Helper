import { describe, expect, it } from "vitest";
import type { GameReview, ReviewFile } from "../src/core/review-schema";
import type { GameTip, TipsFile } from "../src/core/tips-schema";
import { bandOf, buildSeasonSummary, favoriteProbPool, favoriteWon } from "../src/core/season";

/** Ein Spiel: pick Team P, Gegner O. winner "P", "O", "tie" oder null (offen). */
function game(id: string, opts: { deviation?: boolean; winner: "P" | "O" | "tie" | null; pick?: boolean }): GameReview {
  const pickTeamId = opts.pick === false ? null : `P${id}`;
  const final = opts.winner !== null;
  const winnerTeamId = opts.winner === "P" ? `P${id}` : opts.winner === "O" ? `O${id}` : null;
  const deviation = opts.deviation ?? false;
  const correct = !final || pickTeamId === null ? null : pickTeamId === winnerTeamId;
  return {
    gameId: id,
    pickTeamId,
    favoriteTeamId: deviation ? `O${id}` : pickTeamId,
    winnerTeamId,
    final,
    correct,
    deviation,
    deviationEffect: deviation && final && pickTeamId !== null ? (winnerTeamId === null ? 0 : correct ? 1 : -1) : null,
  };
}

function tip(id: string, pickProb: number | null, deviation = false, extra: Record<string, unknown> = {}): GameTip {
  return {
    gameId: id,
    kickoffUtc: "2026-11-01T18:00:00Z",
    odds: null,
    pHome: pickProb,
    pickTeamId: `P${id}`,
    pickProb,
    level: "favorit",
    deviation,
    firstPickTeamId: deviation ? `O${id}` : `P${id}`,
    changedSinceFirst: false,
    locked: true,
    lockedAt: "2026-11-01T18:00:00Z",
    ...extra,
  } as GameTip;
}

const review = (week: number, games: GameReview[], over: Partial<ReviewFile> = {}): ReviewFile => ({
  schemaVersion: 2,
  season: 2026,
  seasonType: 2,
  week,
  updatedAt: "2026-11-04T00:00:00Z",
  complete: true,
  games,
  points: games.filter((g) => g.correct === true).length,
  tipped: games.filter((g) => g.pickTeamId !== null).length,
  deviationNet: games.reduce((s, g) => s + (g.deviationEffect ?? 0), 0),
  tiebreakers: [],
  ...over,
});

const tipsFile = (week: number, tips: GameTip[], season = 2026): TipsFile => ({
  schemaVersion: 1,
  season,
  seasonType: 2,
  week,
  updatedAt: "2026-11-01T00:00:00Z",
  maxDeviations: 2,
  tips,
  tiebreakers: [],
});

describe("Saisonauswertung", () => {
  // Woche 8: Favorit 0.55 gewinnt, Favorit 0.65 verliert, Abweichung auf Aussenseiter 0.4 gewinnt,
  // Favorit 0.85 gewinnt, Unentschieden mit Favorit 0.72, ein Spiel ohne Tipp.
  const w8 = review(8, [
    game("1", { winner: "P" }),
    game("2", { winner: "O" }),
    game("3", { winner: "P", deviation: true }),
    game("4", { winner: "P" }),
    game("5", { winner: "tie" }),
    game("6", { winner: "P", pick: false }),
  ], {
    tiebreakers: [
      { gameId: "4", slot: "monday", predictedHome: 24, predictedAway: 20, actualHome: 27, actualAway: 20, diff: 3 },
      { gameId: "1", slot: "thursday", predictedHome: 24, predictedAway: 20, actualHome: null, actualAway: null, diff: null },
    ],
  });
  // Woche 9: Abweichung auf Aussenseiter 0.3 verliert, ein offenes Spiel, mit KI Vergleich.
  const w9 = review(9, [game("7", { winner: "O", deviation: true }), game("8", { winner: null })], {
    complete: false,
    tiebreakers: [{ gameId: "7", slot: "thursday", predictedHome: 20, predictedAway: 23, actualHome: 30, actualAway: 10, diff: 23 }],
    opinionCompare: {
      opinions: 2,
      scored: 2,
      marketHits: 1,
      aiHits: 2,
      marketHitRate: 0.5,
      aiHitRate: 1,
      marketBrier: 0.3,
      aiBrier: 0.1,
      disagreements: [],
    },
  });
  const tips = [
    tipsFile(8, [tip("1", 0.55), tip("2", 0.65), tip("3", 0.4, true, { fpiPick: 0.5 }), tip("4", 0.85), tip("5", 0.72)]),
    tipsFile(9, [tip("7", 0.3, true), tip("8", 0.6)]),
    tipsFile(8, [tip("1", 0.99)], 2025),
  ];
  const fpiPickProb = (t: GameTip) => {
    const v = (t as GameTip & { fpiPick?: number }).fpiPick;
    return typeof v === "number" ? v : null;
  };
  const s = buildSeasonSummary({
    season: 2026,
    reviews: [w9, w8, review(1, [game("x", { winner: "P" })], { season: 2025 })],
    tips,
    fpiPickProb,
  });

  it("App Punkte gegen reinen Favoritentipp", () => {
    expect(s).toMatchObject({ season: 2026, weeks: 2, completeWeeks: 1, games: 6, appPoints: 3, favoritePoints: 3, appMinusFavorite: 0 });
    expect(s.weekRows).toEqual([
      { seasonType: 2, week: 8, complete: true, appPoints: 3, favoritePoints: 2, deviationNet: 1 },
      { seasonType: 2, week: 9, complete: false, appPoints: 0, favoritePoints: 1, deviationNet: -1 },
    ]);
  });

  it("Abweichungen netto gegen Erwartung 2p minus 1", () => {
    expect(s.deviations.count).toBe(2);
    expect(s.deviations.scored).toBe(2);
    expect(s.deviations.hits).toBe(1);
    expect(s.deviations.net).toBe(0);
    // (2*0.4-1) + (2*0.3-1) = -0.2 - 0.4
    expect(s.deviations.expectedNet).toBeCloseTo(-0.6, 6);
    expect(s.deviations.luck).toBeCloseTo(0.6, 6);
  });

  it("Trefferquote je Band gegen Erwartung, Unentschieden zählt nicht", () => {
    const by = Object.fromEntries(s.bands.map((b) => [b.band, b]));
    // 50-60: Spiel 1 (0.55, Favorit gewann). 60-70: Spiel 2 (0.65 verlor), Spiel 3 Favorit 0.6 verlor.
    // 70-80: Spiel 7 Favorit 0.7 gewann, Spiel 5 Unentschieden fällt weg. 80+: Spiel 4.
    expect(by["50-60"]).toMatchObject({ games: 1, hits: 1, hitRate: 1, expectedRate: 0.55 });
    expect(by["60-70"]).toMatchObject({ games: 2, hits: 0, hitRate: 0, expectedRate: 0.625, diff: -0.625 });
    expect(by["70-80"]).toMatchObject({ games: 1, hits: 1, expectedRate: 0.7 });
    expect(by["80+"]).toMatchObject({ games: 1, hits: 1, expectedRate: 0.85 });
  });

  it("Brier Score Markt, KI gewichtet und FPI optional", () => {
    // Markt aus Sicht des Tipps: (0.55-1)^2 + (0.65-0)^2 + (0.4-1)^2 + (0.85-1)^2 + (0.3-0)^2, geteilt durch 5.
    const expected = (0.2025 + 0.4225 + 0.36 + 0.0225 + 0.09) / 5;
    expect(s.brier.market.n).toBe(5);
    expect(s.brier.market.value).toBeCloseTo(expected, 4);
    expect(s.brier.ai).toEqual({ n: 2, value: 0.1 });
    expect(s.brier.marketOnOpinions).toEqual({ n: 2, value: 0.3 });
    expect(s.brier.fpi).toEqual({ n: 1, value: 0.25 });
  });

  it("mittlere Tiebreaker Abweichung nur über gewertete Tiebreaker", () => {
    expect(s.tiebreaker).toEqual({ count: 2, meanDiff: 13 });
  });

  it("leere Saison liefert Nullen und null statt NaN", () => {
    const e = buildSeasonSummary({ season: 2030, reviews: [w8], tips });
    expect(e).toMatchObject({ weeks: 0, games: 0, appPoints: 0 });
    expect(e.deviations.expectedNet).toBeNull();
    expect(e.bands.every((b) => b.hitRate === null)).toBe(true);
    expect(e.brier.market.value).toBeNull();
    expect(e.brier.fpi).toEqual({ n: 0, value: null });
    expect(e.tiebreaker.meanDiff).toBeNull();
  });

  it("Hilfsfunktionen", () => {
    expect(bandOf(0.5)).toBe("50-60");
    expect(bandOf(0.6)).toBe("60-70");
    expect(bandOf(1)).toBe("80+");
    expect(bandOf(0.49)).toBeNull();
    expect(favoriteWon(game("1", { winner: "O", deviation: true }))).toBe(true);
    expect(favoriteWon(game("1", { winner: "tie" }))).toBeNull();
    expect(favoriteProbPool([tips[0]!])).toEqual([0.55, 0.65, 0.6, 0.85, 0.72]);
  });
});

describe("marketOnFpi", () => {
  it("Markt Brier auf denselben Spielen wie FPI", () => {
    const tips = [tipsFile(8, [tip("1", 0.6, false, { fpi: 0.7 }), tip("2", 0.8)])];
    const s = buildSeasonSummary({
      season: 2026,
      reviews: [review(8, [game("1", { winner: "P" }), game("2", { winner: "O" })])],
      tips,
      fpiPickProb: (t) => (t as GameTip & { fpi?: number }).fpi ?? null,
    });
    expect(s.brier.fpi).toEqual({ n: 1, value: 0.09 });
    expect(s.brier.marketOnFpi).toEqual({ n: 1, value: 0.16 });
    expect(s.brier.market.n).toBe(2);
  });
});
