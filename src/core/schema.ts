// Datenvertrag zwischen Jobs (Schreiber) und App (Leser). Siehe D017.
// Jede Änderung erhöht SCHEMA_VERSION und braucht einen Eintrag in DECISIONS.md.
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const TeamSchema = z.object({
  id: z.string(), // ESPN Team ID
  abbr: z.string(), // z. B. "KC"
  name: z.string(), // z. B. "Kansas City Chiefs"
  shortName: z.string(), // z. B. "Chiefs"
  logo: z.string().url().nullable(),
  color: z.string().nullable(), // Hex ohne #
});
export type Team = z.infer<typeof TeamSchema>;

export const GameStatusSchema = z.enum(["scheduled", "in_progress", "final", "postponed", "canceled"]);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const GameSchema = z.object({
  id: z.string(), // ESPN Event ID
  season: z.number().int(),
  seasonType: z.number().int(), // 1 Preseason, 2 Regular, 3 Postseason
  week: z.number().int(),
  kickoffUtc: z.string().datetime(), // ISO 8601 UTC, immer mit Z
  homeId: z.string(),
  awayId: z.string(),
  status: GameStatusSchema,
  statusDetail: z.string(), // Anzeige Text der Quelle, z. B. "13:43 - 2nd"
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
  venue: z.string().nullable(),
  neutralSite: z.boolean(),
});
export type Game = z.infer<typeof GameSchema>;

export const WeekFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  fetchedAt: z.string().datetime(),
  source: z.literal("espn"),
  games: z.array(GameSchema),
  byeTeamIds: z.array(z.string()),
});
export type WeekFile = z.infer<typeof WeekFileSchema>;

export const TeamsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  fetchedAt: z.string().datetime(),
  teams: z.array(TeamSchema),
});
export type TeamsFile = z.infer<typeof TeamsFileSchema>;

// Zeigt auf die aktuell relevante Woche. Pfad relativ zu data/.
export const CurrentFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  weekFile: z.string(), // z. B. "weeks/2026-2-08.json"
  updatedAt: z.string().datetime(),
});
export type CurrentFile = z.infer<typeof CurrentFileSchema>;

// D016: Tippschluss ist eine Einstellung, nicht fest einprogrammiert.
export const SettingsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  lockMode: z.enum(["per_kickoff", "weekly"]),
  timezone: z.literal("Europe/Zurich"),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/** Dateiname einer Woche relativ zu data/, Woche zweistellig. */
export function weekFilePath(season: number, seasonType: number, week: number): string {
  return `weeks/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}
