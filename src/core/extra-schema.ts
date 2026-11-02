// Datenverträge für den Ausbau nach D042 (Sprint 5 bis 8). Schreiber: Jobs. Leser: App.
import { z } from "zod";

export const EXTRA_SCHEMA_VERSION = 1 as const;

const weekRef = {
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
};

/** data/weeks/index.json: alle verfügbaren Wochen, aufsteigend. Pfade relativ zu data/. */
export const WeeksIndexSchema = z.object({
  schemaVersion: z.literal(EXTRA_SCHEMA_VERSION),
  updatedAt: z.string().datetime(),
  weeks: z.array(
    z.object({
      ...weekRef,
      weekFile: z.string().regex(/^weeks\/\d{4}-\d-\d{2}\.json$/),
      tipsFile: z.string().regex(/^tips\/\d{4}-\d-\d{2}\.json$/).nullable(),
      reviewFile: z.string().regex(/^reviews\/\d{4}-\d-\d{2}\.json$/).nullable(),
      opinionFile: z.string().regex(/^opinions\/\d{4}-\d-\d{2}\.json$/).nullable(),
    }),
  ),
});
export type WeeksIndex = z.infer<typeof WeeksIndexSchema>;

/** data/news.json: neueste Meldungen, absteigend nach publishedAt, höchstens 150. Nur Titel, Anriss, Link. */
export const NewsFileSchema = z.object({
  schemaVersion: z.literal(EXTRA_SCHEMA_VERSION),
  updatedAt: z.string().datetime(),
  items: z.array(
    z.object({
      id: z.string(), // stabiler Hash aus der normalisierten URL
      source: z.enum(["espn", "cbs", "pft"]),
      url: z.string().url(),
      title: z.string().max(300),
      summary: z.string().max(400).nullable(), // Anriss ohne HTML
      publishedAt: z.string().datetime(),
      teamIds: z.array(z.string()), // ESPN Team IDs, erkannt aus Titel und Anriss
    }),
  ),
});
export type NewsFile = z.infer<typeof NewsFileSchema>;

/** data/opinions/<season>-<type>-<ww>.json: KI Zweitmeinung im Schattenmodus (D040). */
export const OpinionsFileSchema = z.object({
  schemaVersion: z.literal(EXTRA_SCHEMA_VERSION),
  ...weekRef,
  updatedAt: z.string().datetime(),
  model: z.string(),
  opinions: z.array(
    z.object({
      gameId: z.string(),
      createdAt: z.string().datetime(), // vor Kickoff, danach nie geändert
      winnerTeamId: z.string(),
      pWinner: z.number().min(0.5).max(1),
      marketPickTeamId: z.string().nullable(), // Grundtipp aus der Quote zum Zeitpunkt der Meinung
      marketProb: z.number().min(0).max(1).nullable(),
      reasoning: z.string().max(600), // 2 bis 3 Sätze, Deutsch
      sources: z.array(z.object({ title: z.string().max(200), url: z.string().url() })).min(1),
    }),
  ),
});
export type OpinionsFile = z.infer<typeof OpinionsFileSchema>;

export function opinionsFilePath(season: number, seasonType: number, week: number): string {
  return `opinions/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}
