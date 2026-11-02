// Wochenindex (D042): data/weeks/index.json aus den vorhandenen Dateien. Reine Logik ohne Node APIs.
import { EXTRA_SCHEMA_VERSION, WeeksIndexSchema, opinionsFilePath, type WeeksIndex } from "./extra-schema";
import { weekFilePath } from "./schema";
import { tipsFilePath } from "./tips-schema";
import { reviewFilePath } from "./review-schema";

export const WEEKS_INDEX_PATH = "weeks/index.json";

export interface WeekKey {
  season: number;
  seasonType: number;
  week: number;
}

const WEEK_FILE_RE = /^(\d{4})-(\d)-(\d{2})\.json$/;

/** Liest Saison, Typ und Woche aus einem Dateinamen wie "2026-2-09.json", sonst null. */
export function parseWeekFileName(name: string): WeekKey | null {
  const m = WEEK_FILE_RE.exec(name);
  return m ? { season: Number(m[1]), seasonType: Number(m[2]), week: Number(m[3]) } : null;
}

export function compareWeekKeys(a: WeekKey, b: WeekKey): number {
  return a.season - b.season || a.seasonType - b.seasonType || a.week - b.week;
}

/**
 * Baut den Index aufsteigend. Grundlage sind die Wochendateien, die übrigen Pfade stehen nur,
 * wenn die Datei existiert (exists bekommt den Pfad relativ zu data/).
 */
export function buildWeeksIndex(weeks: readonly WeekKey[], exists: (path: string) => boolean, now: string): WeeksIndex {
  const unique = new Map<string, WeekKey>();
  for (const k of weeks) unique.set(`${k.season}-${k.seasonType}-${k.week}`, k);
  const sorted = [...unique.values()].sort(compareWeekKeys);
  const opt = (p: string) => (exists(p) ? p : null);
  return WeeksIndexSchema.parse({
    schemaVersion: EXTRA_SCHEMA_VERSION,
    updatedAt: now,
    weeks: sorted.map((k) => ({
      season: k.season,
      seasonType: k.seasonType,
      week: k.week,
      weekFile: weekFilePath(k.season, k.seasonType, k.week),
      tipsFile: opt(tipsFilePath(k.season, k.seasonType, k.week)),
      reviewFile: opt(reviewFilePath(k.season, k.seasonType, k.week)),
      opinionFile: opt(opinionsFilePath(k.season, k.seasonType, k.week)),
    })),
  });
}

export function sameWeeksIndex(a: WeeksIndex, b: WeeksIndex): boolean {
  return JSON.stringify(a.weeks) === JSON.stringify(b.weeks);
}
