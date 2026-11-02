import { describe, expect, it } from "vitest";
import type { Game } from "../src/core/schema";
import type { GameTip, TipsFile } from "../src/core/tips-schema";
import { buildReview, buildReviewIndex, reviewGame, sameReviewContent, tiebreakerDiff, winnerOf } from "../src/core/review";
import { ReviewFileSchema, ReviewIndexSchema } from "../src/core/review-schema";

const NOW = "2026-11-04T10:00:00Z";

const game = (id: string, home: number | null, away: number | null, status: Game["status"] = "final"): Game => ({
  id,
  season: 2026,
  seasonType: 2,
  week: 8,
  kickoffUtc: "2026-11-01T18:00:00Z",
  homeId: "H" + id,
  awayId: "A" + id,
  status,
  statusDetail: status,
  homeScore: home,
  awayScore: away,
  venue: null,
  neutralSite: false,
});

const tip = (id: string, pick: "home" | "away" | null, over: Partial<GameTip> = {}): GameTip => {
  const pickTeamId = pick === null ? null : pick === "home" ? "H" + id : "A" + id;
  const deviation = over.deviation ?? false;
  const fav = pickTeamId === null ? null : deviation ? (pick === "home" ? "A" + id : "H" + id) : pickTeamId;
  return {
    gameId: id,
    kickoffUtc: "2026-11-01T18:00:00Z",
    odds: null,
    pHome: 0.6,
    pickTeamId,
    pickProb: 0.6,
    level: pick === null ? "nicht_erfasst" : "favorit",
    deviation,
    firstPickTeamId: fav,
    changedSinceFirst: deviation,
    locked: true,
    lockedAt: "2026-11-01T18:00:00Z",
    ...over,
  };
};

const tipsFile = (tips: GameTip[], tiebreakers: TipsFile["tiebreakers"] = []): TipsFile => ({
  schemaVersion: 1,
  season: 2026,
  seasonType: 2,
  week: 8,
  updatedAt: "2026-11-01T18:00:00Z",
  maxDeviations: 2,
  tips,
  tiebreakers,
});

describe("winnerOf", () => {
  it("Heim, Gast, Unentschieden, offen", () => {
    expect(winnerOf(game("1", 24, 17))).toBe("H1");
    expect(winnerOf(game("1", 10, 17))).toBe("A1");
    expect(winnerOf(game("1", 20, 20))).toBeNull();
    expect(winnerOf(game("1", 20, 10, "in_progress"))).toBeNull();
    expect(winnerOf(undefined)).toBeNull();
  });
});

describe("reviewGame", () => {
  it("correct heisst Tipp gleich Sieger", () => {
    expect(reviewGame(tip("1", "home"), game("1", 24, 17))).toMatchObject({ correct: true, winnerTeamId: "H1", final: true });
    expect(reviewGame(tip("1", "away"), game("1", 24, 17))).toMatchObject({ correct: false });
  });

  it("Unentschieden zählt als falsch", () => {
    const r = reviewGame(tip("1", "home"), game("1", 20, 20));
    expect(r).toMatchObject({ final: true, winnerTeamId: null, correct: false, deviationEffect: null });
  });

  it("offenes Spiel: correct und deviationEffect null", () => {
    const r = reviewGame(tip("1", "home", { deviation: true }), game("1", 14, 7, "in_progress"));
    expect(r).toMatchObject({ final: false, correct: null, winnerTeamId: null, deviationEffect: null });
    expect(reviewGame(tip("1", "home"), undefined)).toMatchObject({ final: false, correct: null });
  });

  it("ohne Tipp correct null, nicht_erfasst zählt nicht", () => {
    const r = reviewGame(tip("1", null), game("1", 24, 17));
    expect(r).toMatchObject({ pickTeamId: null, correct: null, deviationEffect: null });
  });

  it("Abweichung: +1 wenn der Aussenseiter gewann, -1 wenn der Favorit gewann, 0 bei Unentschieden", () => {
    const dev = tip("1", "away", { deviation: true });
    expect(dev.firstPickTeamId).toBe("H1");
    expect(reviewGame(dev, game("1", 10, 17))).toMatchObject({ correct: true, deviationEffect: 1, favoriteTeamId: "H1" });
    expect(reviewGame(dev, game("1", 24, 17))).toMatchObject({ correct: false, deviationEffect: -1 });
    expect(reviewGame(dev, game("1", 17, 17))).toMatchObject({ correct: false, deviationEffect: 0 });
  });

  it("ohne Abweichung kein deviationEffect", () => {
    expect(reviewGame(tip("1", "home"), game("1", 24, 17)).deviationEffect).toBeNull();
  });
});

describe("tiebreakerDiff", () => {
  it("Summe der absoluten Abweichungen", () => {
    expect(tiebreakerDiff(25, 22, 25, 22)).toBe(0);
    expect(tiebreakerDiff(25, 22, 20, 30)).toBe(13);
    expect(tiebreakerDiff(10, 30, 17, 14)).toBe(23);
  });
});

describe("buildReview", () => {
  const tips = tipsFile(
    [tip("1", "home"), tip("2", "away", { deviation: true }), tip("3", "home"), tip("4", null), tip("5", "away", { deviation: true })],
    [{ gameId: "5", slot: "monday", homePoints: 25, awayPoints: 22, basis: "quote" }],
  );

  it("komplette Woche: Punkte, getippt, Abweichungen netto, Tiebreaker", () => {
    const games = [game("1", 24, 17), game("2", 10, 17), game("3", 20, 20), game("4", 3, 0), game("5", 30, 20)];
    const r = buildReview(tips, games, NOW);
    expect(ReviewFileSchema.parse(r)).toEqual(r);
    expect(r).toMatchObject({ complete: true, points: 2, tipped: 4, deviationNet: 0, updatedAt: NOW });
    expect(r.tiebreakers).toEqual([
      { gameId: "5", slot: "monday", predictedHome: 25, predictedAway: 22, actualHome: 30, actualAway: 20, diff: 7 },
    ]);
  });

  it("offene Spiele: Zwischenstand ohne Tiebreaker Resultat", () => {
    const games = [game("1", 24, 17), game("2", 10, 17), game("3", 20, 20), game("4", 3, 0), game("5", 0, 0, "scheduled")];
    const r = buildReview(tips, games, NOW);
    expect(r).toMatchObject({ complete: false, points: 2, tipped: 4, deviationNet: 1 });
    expect(r.tiebreakers[0]).toMatchObject({ actualHome: null, actualAway: null, diff: null });
  });

  it("fehlendes Spiel ist offen, abgesagtes blockiert nicht", () => {
    const games = [game("1", 24, 17), game("2", 10, 17), game("3", 20, 20), game("4", 3, 0)];
    expect(buildReview(tips, games, NOW).complete).toBe(false);
    const r = buildReview(tips, [...games, game("5", null, null, "canceled")], NOW);
    expect(r.complete).toBe(true);
    expect(r.games[4]).toMatchObject({ final: false, correct: null });
  });

  it("leere Tippdatei ist nie komplett", () => {
    expect(buildReview(tipsFile([]), [], NOW).complete).toBe(false);
  });

  it("sameReviewContent ignoriert updatedAt", () => {
    const games = [game("1", 24, 17)];
    const a = buildReview(tips, games, NOW);
    expect(sameReviewContent(a, buildReview(tips, games, "2026-11-05T00:00:00Z"))).toBe(true);
    expect(sameReviewContent(a, buildReview(tips, [game("1", 10, 17)], NOW))).toBe(false);
  });
});

describe("buildReviewIndex", () => {
  it("absteigend nach Saison, Typ und Woche, ohne Duplikate", () => {
    const idx = buildReviewIndex([
      "reviews/2026-2-08.json",
      "reviews/2026-2-10.json",
      "reviews/2026-3-01.json",
      "reviews/2025-2-18.json",
      "reviews/2026-2-09.json",
      "reviews/2026-2-08.json",
    ]);
    expect(idx).toEqual([
      "reviews/2026-3-01.json",
      "reviews/2026-2-10.json",
      "reviews/2026-2-09.json",
      "reviews/2026-2-08.json",
      "reviews/2025-2-18.json",
    ]);
  });

  it("Schema lehnt fremde Pfade ab", () => {
    expect(ReviewIndexSchema.safeParse(["reviews/2026-2-8.json"]).success).toBe(false);
    expect(ReviewIndexSchema.safeParse(["../x.json"]).success).toBe(false);
  });
});
