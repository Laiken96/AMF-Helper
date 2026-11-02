// Datenvertrag Tippliste (Sprint 2). Schreiber: jobs/build-tips.ts. Leser: App.
// Eigene Dateien unter data/, damit WeekFileSchema (schemaVersion 1) unverändert bleibt.
import { z } from "zod";

// Version 2 (D050): Feld firstOdds pro Tipp für die Linienbewegung. Version 1 bleibt lesbar, das Feld ist optional.
export const TIPS_SCHEMA_VERSION = 2 as const;
/** Die Rangliste hat ihre eigene Version und bleibt bei 1. */
export const STANDINGS_SCHEMA_VERSION = 2 as const; // 2 ergänzt season, Version 1 bleibt lesbar

/** Quote eines Spiels aus ESPN (D024). spreadHome negativ heisst Heimteam favorisiert. */
export const OddsSchema = z.object({
  provider: z.string(), // z. B. "DraftKings"
  spreadHome: z.number(), // Punkte aus Sicht Heimteam, z. B. -10 bei KC -10 als Heimteam
  overUnder: z.number().nullable(),
  fetchedAt: z.string().datetime(),
});
export type Odds = z.infer<typeof OddsSchema>;

export const TipLevelSchema = z.enum(["klar", "favorit", "unklar", "offen", "nicht_erfasst"]);
// klar: Favorit ab 75 Prozent, favorit: 60 bis unter 75, unklar: unter 60, offen: keine Quote.
// nicht_erfasst: Spiel war beim ersten Lauf schon gesperrt und hatte keinen früheren Tipp, also nie getippt.
// Dann ist pickTeamId null und das Spiel bekommt keinen Tiebreaker Eintrag.

export const GameTipSchema = z.object({
  gameId: z.string(),
  kickoffUtc: z.string().datetime(),
  odds: OddsSchema.nullable(),
  pHome: z.number().min(0).max(1).nullable(), // Siegwahrscheinlichkeit Heimteam, null ohne Quote
  pickTeamId: z.string().nullable(), // aktueller Tipp, null ohne Quote
  pickProb: z.number().min(0).max(1).nullable(), // Wahrscheinlichkeit des getippten Teams
  level: TipLevelSchema,
  deviation: z.boolean(), // true: bewusste Abweichung vom Favoriten (D010, D021)
  firstPickTeamId: z.string().nullable(), // erster berechneter Tipp der Woche (Grundtipp, D023)
  // Erste erfasste Quote, gesetzt beim ersten Lauf mit Quote und danach nie überschrieben wie firstPickTeamId.
  // Fehlt in Version 1. Bei Dateien aus Version 1 ist es die erste nach dem Update gesehene Quote.
  firstOdds: OddsSchema.nullable().optional(),
  changedSinceFirst: z.boolean(),
  locked: z.boolean(), // ab Kickoff true, danach nie mehr neu berechnet (D023)
  lockedAt: z.string().datetime().nullable(),
});
export type GameTip = z.infer<typeof GameTipSchema>;

// D025: Resultat Tipps nur für Thursday Night und Monday Night Game. Massgebend ist der Wochentag in
// America/New_York. Gibt es mehrere Spiele an diesem Tag (Thanksgiving, Doppel Monday Night), gilt das späteste.
export const TiebreakerSchema = z.object({
  gameId: z.string(),
  slot: z.enum(["thursday", "monday"]),
  homePoints: z.number().int().min(0),
  awayPoints: z.number().int().min(0),
  basis: z.enum(["quote", "standard"]), // standard: ohne Over/Under 23 zu 20 für den Favoriten
});

export const TipsFileSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(TIPS_SCHEMA_VERSION)]),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  updatedAt: z.string().datetime(),
  maxDeviations: z.number().int().min(0), // erlaubte Abweichungen laut D021
  tips: z.array(GameTipSchema),
  tiebreakers: z.array(TiebreakerSchema).max(2), // 0 bis 2 Einträge, Woche ohne TNF oder MNF hat weniger
});
export type TipsFile = z.infer<typeof TipsFileSchema>;

/** Ranglistenstand, manuell gepflegt bis Sprint 4. Nur Kürzel, nie Namen (D022). */
export const StandingsFileSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(STANDINGS_SCHEMA_VERSION)]),
  season: z.number().int().optional(), // fehlt in Version 1
  asOfWeek: z.number().int(),
  updatedAt: z.string().datetime(),
  me: z.string(), // eigenes Kürzel
  players: z.array(z.object({ id: z.string().regex(/^[A-Z]{2,3}$/), points: z.number().int().min(0) })),
});
export type StandingsFile = z.infer<typeof StandingsFileSchema>;

export function tipsFilePath(season: number, seasonType: number, week: number): string {
  return `tips/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}
