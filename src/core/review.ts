// Wochenbilanz (Sprint 4, D032): reine Logik ohne Netz. Schreiber ist jobs/build-review.ts.
import type { Game } from "./schema";
import type { TipsFile } from "./tips-schema";
import {
  REVIEW_SCHEMA_VERSION,
  ReviewFileSchema,
  ReviewIndexSchema,
  type GameReview,
  type ReviewFile,
  type ReviewIndex,
} from "./review-schema";

/** Sieger eines finalen Spiels, null bei Unentschieden, offenem Spiel oder fehlendem Spielstand. */
export function winnerOf(game: Game | undefined): string | null {
  if (!game || game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  if (game.homeScore === game.awayScore) return null;
  return game.homeScore > game.awayScore ? game.homeId : game.awayId;
}

export const VOID_AFTER_DAYS = 7;

/**
 * Spiel fällt aus der Wertung: abgesagt, oder verschoben bzw. ohne Daten ab Kickoff plus 7 Tage.
 * Solche Spiele bringen keinen Punkt und zählen nicht in tipped.
 */
export function isVoid(game: Game | undefined, kickoffUtc: string, now: string): boolean {
  if (game?.status === "canceled") return true;
  if (game !== undefined && game.status !== "postponed") return false;
  const kickoff = Date.parse(game?.kickoffUtc ?? kickoffUtc);
  return Date.parse(now) >= kickoff + VOID_AFTER_DAYS * 86_400_000;
}

/** Spiel ist erledigt: final mit Spielstand oder aus der Wertung gefallen. */
function settled(game: Game | undefined, kickoffUtc: string, now: string): boolean {
  if (game?.status === "final" && game.homeScore !== null && game.awayScore !== null) return true;
  return isVoid(game, kickoffUtc, now);
}

/**
 * Bewertet einen Tipp. Unentschieden zählt als falsch.
 * deviationEffect nur bei Abweichung: +1 wenn der getippte Aussenseiter gewann, -1 wenn der Favorit gewann, 0 bei Unentschieden.
 */
export function reviewGame(
  tip: TipsFile["tips"][number],
  game: Game | undefined,
): GameReview {
  const final = game?.status === "final" && game.homeScore !== null && game.awayScore !== null;
  const pickTeamId = tip.level === "nicht_erfasst" || tip.level === "offen" ? null : tip.pickTeamId;
  const winnerTeamId = final ? winnerOf(game) : null;
  const correct = !final || pickTeamId === null ? null : pickTeamId === winnerTeamId;
  let deviationEffect: number | null = null;
  if (tip.deviation && final && pickTeamId !== null) {
    deviationEffect = winnerTeamId === null ? 0 : winnerTeamId === pickTeamId ? 1 : -1;
  }
  return {
    gameId: tip.gameId,
    pickTeamId,
    favoriteTeamId: tip.firstPickTeamId,
    winnerTeamId,
    final,
    correct,
    deviation: tip.deviation,
    deviationEffect,
  };
}

/** Summe der absoluten Abweichungen beider Teams. */
export function tiebreakerDiff(predHome: number, predAway: number, actHome: number, actAway: number): number {
  return Math.abs(predHome - actHome) + Math.abs(predAway - actAway);
}

/** Baut die Bilanz einer Woche aus Tippdatei und Spielständen. */
export function buildReview(tips: TipsFile, games: readonly Game[], now: string): ReviewFile {
  const byId = new Map(games.map((g) => [g.id, g]));
  const reviews = tips.tips.map((t) => reviewGame(t, byId.get(t.gameId)));
  const voided = new Set(tips.tips.filter((t) => isVoid(byId.get(t.gameId), t.kickoffUtc, now)).map((t) => t.gameId));
  const tiebreakers = tips.tiebreakers.map((tb) => {
    const g = byId.get(tb.gameId);
    const final = g?.status === "final" && g.homeScore !== null && g.awayScore !== null;
    const actualHome = final ? g.homeScore : null;
    const actualAway = final ? g.awayScore : null;
    return {
      gameId: tb.gameId,
      slot: tb.slot,
      predictedHome: tb.homePoints,
      predictedAway: tb.awayPoints,
      actualHome,
      actualAway,
      diff: actualHome !== null && actualAway !== null ? tiebreakerDiff(tb.homePoints, tb.awayPoints, actualHome, actualAway) : null,
    };
  });
  return ReviewFileSchema.parse({
    schemaVersion: REVIEW_SCHEMA_VERSION,
    season: tips.season,
    seasonType: tips.seasonType,
    week: tips.week,
    updatedAt: now,
    complete: tips.tips.length > 0 && tips.tips.every((t) => settled(byId.get(t.gameId), t.kickoffUtc, now)),
    games: reviews,
    points: reviews.filter((r) => r.correct === true).length,
    tipped: reviews.filter((r) => r.pickTeamId !== null && !voided.has(r.gameId)).length,
    deviationNet: reviews.reduce((s, r) => s + (r.deviationEffect ?? 0), 0),
    tiebreakers,
  });
}

/** Gleicher Inhalt ohne Zeitstempel, damit nur echte Änderungen geschrieben werden. */
export function sameReviewContent(a: ReviewFile, b: ReviewFile): boolean {
  return JSON.stringify({ ...a, updatedAt: "" }) === JSON.stringify({ ...b, updatedAt: "" });
}

/** Sortiert Review Pfade absteigend. Das feste Format mit zweistelliger Woche sortiert als Text korrekt. */
export function buildReviewIndex(paths: readonly string[]): ReviewIndex {
  return ReviewIndexSchema.parse([...new Set(paths)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
}
