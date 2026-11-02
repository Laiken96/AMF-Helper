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
