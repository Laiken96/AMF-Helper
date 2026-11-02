// Lebenszeichen data/heartbeat.json: GitHub deaktiviert geplante Workflows eines öffentlichen Repos nach 60 Tagen
// ohne Aktivität. In der Offseason entstehen sonst womöglich keine Commits (ruhende Wochen, siehe season-calendar.ts).
// data.yml schreibt die Datei, wenn sie älter als 30 Tage ist, der normale Commit Schritt übernimmt sie.
import { z } from "zod";

export const HEARTBEAT_SCHEMA_VERSION = 1 as const;
export const HEARTBEAT_PATH = "heartbeat.json";
export const HEARTBEAT_INTERVAL_DAYS = 30;

export const HeartbeatFileSchema = z.object({
  schemaVersion: z.literal(HEARTBEAT_SCHEMA_VERSION),
  updatedAt: z.string().datetime(),
});
export type HeartbeatFile = z.infer<typeof HeartbeatFileSchema>;

/** Neues Lebenszeichen nötig? Ja ohne gültige Datei oder wenn das letzte mindestens 30 Tage alt ist. */
export function heartbeatDue(existing: unknown, now: string): boolean {
  const parsed = HeartbeatFileSchema.safeParse(existing);
  if (!parsed.success) return true;
  return Date.parse(now) - Date.parse(parsed.data.updatedAt) >= HEARTBEAT_INTERVAL_DAYS * 86_400_000;
}
