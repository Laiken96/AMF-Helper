// Datenvertrag zwischen Jobs (Schreiber) und App (Leser). Siehe D017.
// Jede Änderung erhöht SCHEMA_VERSION und braucht einen Eintrag in DECISIONS.md.
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;
/**
 * Version der Wochendateien unter data/weeks/. 2 ergänzt die optionalen Felder venueInfo, homeRest und awayRest
 * (D050 Spielort und Ruhetage). Das Schema liest weiterhin Version 1, alte Dateien bleiben gültig.
 */
export const WEEK_SCHEMA_VERSION = 2 as const;

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

export const VenueSchema = z.object({
  name: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(), // z. B. "USA", "England", "Germany"
});
export type Venue = z.infer<typeof VenueSchema>;

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
  venue: z.string().nullable(), // Stadionname, bleibt für bestehende Leser ein Text
  neutralSite: z.boolean(),
  // Ab Wochendatei Version 2, fehlt in älteren Dateien.
  venueInfo: VenueSchema.optional(),
  // Ruhetage seit dem letzten Spiel des Teams (Kalendertage in America/New_York). Fehlt, wenn keine frühere
  // Wochendatei vorliegt, null wenn das Team dort kein Spiel hatte.
  homeRest: z.number().int().min(0).nullable().optional(),
  awayRest: z.number().int().min(0).nullable().optional(),
});
export type Game = z.infer<typeof GameSchema>;

export const WeekFileSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(WEEK_SCHEMA_VERSION)]),
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
  weekFile: z.string().regex(/^weeks\/\d{4}-\d-\d{2}\.json$/), // z. B. "weeks/2026-2-08.json"
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
