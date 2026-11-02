// Datenvertrag Wochenbilanz (Sprint 4, D032). Schreiber: jobs/build-review.ts und der Ranglisten Workflow. Leser: App, Push.
import { z } from "zod";

export const REVIEW_SCHEMA_VERSION = 1 as const;

export const GameReviewSchema = z.object({
  gameId: z.string(),
  pickTeamId: z.string().nullable(), // gesperrter App Tipp, null bei offen oder nicht_erfasst
  favoriteTeamId: z.string().nullable(), // Grundtipp (firstPickTeamId)
  winnerTeamId: z.string().nullable(), // null bei Unentschieden oder nicht final
  final: z.boolean(),
  correct: z.boolean().nullable(), // null wenn nicht final oder kein Tipp
  deviation: z.boolean(),
  deviationEffect: z.number().int().min(-1).max(1).nullable(), // +1 Abweichung brachte Punkt, -1 kostete, 0 egal, null keine Abweichung oder offen
});
export type GameReview = z.infer<typeof GameReviewSchema>;

export const TiebreakerReviewSchema = z.object({
  gameId: z.string(),
  slot: z.enum(["thursday", "monday"]),
  predictedHome: z.number().int(),
  predictedAway: z.number().int(),
  actualHome: z.number().int().nullable(),
  actualAway: z.number().int().nullable(),
  diff: z.number().int().nullable(), // Summe der absoluten Abweichungen beider Teams
});

/**
 * Vergleich Markt gegen KI Zweitmeinung (D040, D042), nur Spiele mit Meinung. Optional, daher bleibt
 * schemaVersion 1. Gewertet werden finale Spiele mit Sieger, Unentschieden und offene Spiele zählen nicht.
 * Brier Score: Mittel von (p minus Ergebnis) im Quadrat, p ist die Wahrscheinlichkeit des gewählten Teams.
 */
export const OpinionCompareSchema = z.object({
  opinions: z.number().int().min(0), // Spiele mit Meinung
  scored: z.number().int().min(0), // davon gewertet
  marketHits: z.number().int().min(0),
  aiHits: z.number().int().min(0),
  marketHitRate: z.number().min(0).max(1).nullable(), // null ohne gewertetes Spiel
  aiHitRate: z.number().min(0).max(1).nullable(),
  marketBrier: z.number().min(0).max(1).nullable(),
  aiBrier: z.number().min(0).max(1).nullable(),
  disagreements: z.array(
    z.object({
      gameId: z.string(),
      marketPickTeamId: z.string().nullable(),
      aiPickTeamId: z.string(),
      winnerTeamId: z.string().nullable(), // null solange offen oder bei Unentschieden
    }),
  ),
});
export type OpinionCompare = z.infer<typeof OpinionCompareSchema>;

export const ReviewFileSchema = z.object({
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  updatedAt: z.string().datetime(),
  complete: z.boolean(), // alle Spiele final
  games: z.array(GameReviewSchema),
  points: z.number().int().min(0), // richtige App Tipps
  tipped: z.number().int().min(0), // Spiele mit App Tipp
  deviationNet: z.number().int(), // Summe deviationEffect
  tiebreakers: z.array(TiebreakerReviewSchema),
  opinionCompare: OpinionCompareSchema.optional(), // fehlt ohne Meinungsdatei der Woche
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

/** Verlauf der Gruppenrangliste, ein Eintrag pro gemeldeter Woche. Nur Kürzel (D022). */
export const StandingsHistorySchema = z.object({
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  entries: z.array(
    z.object({
      season: z.number().int(),
      seasonType: z.number().int().min(1).max(3).default(2), // fehlt in alten Einträgen, dann Regular Season
      week: z.number().int(), // Stand nach dieser Woche
      reportedAt: z.string().datetime(),
      players: z.array(z.object({ id: z.string().regex(/^[A-Z]{2,3}$/), points: z.number().int().min(0) })),
    }),
  ),
});
export type StandingsHistory = z.infer<typeof StandingsHistorySchema>;

export function reviewFilePath(season: number, seasonType: number, week: number): string {
  return `reviews/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}

/** data/reviews/index.json: Review Pfade relativ zu data/, absteigend nach Saison, Typ und Woche. */
export const ReviewIndexSchema = z.array(z.string().regex(/^reviews\/\d{4}-\d-\d{2}\.json$/));
export type ReviewIndex = z.infer<typeof ReviewIndexSchema>;

export const REVIEW_INDEX_PATH = "reviews/index.json";
