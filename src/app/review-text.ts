// Texte der Bilanz ohne React, damit sie sich ohne Oberfläche prüfen lassen.
import type { RankingCheck } from "../core/review-schema";

/** Abgleich der gemeldeten Wochenpunkte mit den App Tipps (D050). Nur mit rankingCheck in der Bilanz. */
export function rankingCheckText(c: RankingCheck): string {
  const base = `Gemeldet ${c.reported}, App Tipps ${c.appPoints}`;
  if (c.gap === 0) return `${base}: stimmt überein.`;
  const diff = Math.abs(c.gap);
  return c.gap < 0
    ? `${base}, Differenz ${diff}: Tipp vergessen oder anders eingetragen?`
    : `${base}, Differenz ${diff}: mehr Punkte als mit den App Tipps, ein Tipp anders eingetragen?`;
}
