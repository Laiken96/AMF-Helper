// Zeitumrechnung UTC zu Europe/Zurich und Gruppierung nach Kickoff Slot. Siehe D006.
// Nur Intl API. Die NFL Woche wird nie aus einem Datum abgeleitet, sondern kommt aus der Quelle.

export const DISPLAY_TZ = "Europe/Zurich";

const WEEKDAYS_DE: Record<string, string> = {
  Mon: "Mo",
  Tue: "Di",
  Wed: "Mi",
  Thu: "Do",
  Fri: "Fr",
  Sat: "Sa",
  Sun: "So",
};

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

export interface ZurichParts {
  weekday: string; // Mo bis So
  year: string;
  month: string; // zweistellig
  day: string; // zweistellig
  hour: string; // zweistellig, 00 bis 23
  minute: string;
  offset: string; // z. B. "+01:00"
}

/** Zerlegt einen UTC Zeitpunkt in seine Bestandteile in Europe/Zurich. */
export function zurichParts(iso: string): ZurichParts {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Ungültiger Zeitpunkt: ${iso}`);
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) map[p.type] = p.value;
  const tz = map.timeZoneName ?? "GMT";
  const offset = tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
  return {
    weekday: WEEKDAYS_DE[map.weekday ?? ""] ?? map.weekday ?? "",
    year: map.year ?? "",
    month: map.month ?? "",
    day: map.day ?? "",
    hour: map.hour === "24" ? "00" : (map.hour ?? ""),
    minute: map.minute ?? "",
    offset,
  };
}

/** Anzeige der Kickoff Zeit in Europe/Zurich, z. B. "So 02.11. 02:20". */
export function formatKickoffZurich(iso: string): string {
  const p = zurichParts(iso);
  return `${p.weekday} ${p.day}.${p.month}. ${p.hour}:${p.minute}`;
}

/** Nur Uhrzeit in Europe/Zurich, z. B. "19:00". */
export function formatTimeZurich(iso: string): string {
  const p = zurichParts(iso);
  return `${p.hour}:${p.minute}`;
}

/**
 * Schlüssel eines Kickoff Slots als lokale Zeit in Europe/Zurich mit Offset,
 * z. B. "2026-11-02T02:20+01:00". Der Offset trennt die doppelte Stunde beim Ende der Sommerzeit.
 */
export function kickoffSlotKey(iso: string): string {
  const p = zurichParts(iso);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}${p.offset}`;
}

export interface KickoffSlot<T> {
  slotKey: string;
  kickoffUtc: string;
  label: string;
  games: T[];
}

/** Gruppiert Spiele nach Kickoff Zeit in Europe/Zurich, Slots und Spiele chronologisch, bei Gleichstand nach ID. */
export function groupBySlot<T extends { id: string; kickoffUtc: string }>(games: readonly T[]): KickoffSlot<T>[] {
  const sorted = [...games].sort((a, b) => {
    const d = Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc);
    return d !== 0 ? d : a.id.localeCompare(b.id, "en", { numeric: true });
  });
  const slots = new Map<string, KickoffSlot<T>>();
  for (const g of sorted) {
    const key = kickoffSlotKey(g.kickoffUtc);
    let slot = slots.get(key);
    if (!slot) {
      slot = { slotKey: key, kickoffUtc: g.kickoffUtc, label: formatKickoffZurich(g.kickoffUtc), games: [] };
      slots.set(key, slot);
    }
    slot.games.push(g);
  }
  return [...slots.values()];
}

const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** Kalendertag eines Zeitpunkts in America/New_York als Tageszahl seit 1970, unabhängig von der Sommerzeit. */
export function newYorkDayNumber(iso: string): number {
  const [y, m, d] = NY_DATE.format(new Date(iso)).split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

interface RestGame {
  id: string;
  kickoffUtc: string;
  homeId: string;
  awayId: string;
  status: string;
}

/**
 * Ruhetage eines Teams vor einem Spiel: Kalendertage in America/New_York seit seinem letzten Spiel vor diesem
 * Kickoff, z. B. Sonntag zu Sonntag 7, Sonntag zu Donnerstag 4. Abgesagte Spiele zählen nicht.
 * previousGames enthält die Spiele früherer Wochen, gern mehrere, damit eine Bye Woche überbrückt wird.
 * null, wenn das Team dort kein früheres Spiel hat.
 */
export function restDays(teamId: string, game: Pick<RestGame, "id" | "kickoffUtc">, previousGames: readonly RestGame[]): number | null {
  const kickoff = Date.parse(game.kickoffUtc);
  let last: number | null = null;
  for (const g of previousGames) {
    if (g.id === game.id || g.status === "canceled") continue;
    if (g.homeId !== teamId && g.awayId !== teamId) continue;
    const t = Date.parse(g.kickoffUtc);
    if (t < kickoff && (last === null || t > last)) last = t;
  }
  if (last === null) return null;
  return newYorkDayNumber(game.kickoffUtc) - newYorkDayNumber(new Date(last).toISOString());
}

/** Ergänzt homeRest und awayRest für alle Spiele. Ohne frühere Spiele bleiben die Spiele unverändert. */
export function withRestDays<T extends RestGame>(games: readonly T[], previousGames: readonly RestGame[] | null): Array<T & { homeRest?: number | null; awayRest?: number | null }> {
  if (previousGames === null || previousGames.length === 0) return [...games];
  return games.map((g) => ({ ...g, homeRest: restDays(g.homeId, g, previousGames), awayRest: restDays(g.awayId, g, previousGames) }));
}
