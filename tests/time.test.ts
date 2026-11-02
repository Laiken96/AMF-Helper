import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScoreboard } from "../src/core/espn";
import { formatKickoffZurich, formatTimeZurich, groupBySlot, kickoffSlotKey } from "../src/core/time";

describe("formatKickoffZurich", () => {
  it("formatiert wie in der Vorgabe", () => {
    // 2026-11-02T01:20Z ist Sonntagnacht ET, in Zürich Montag 02:20 (MEZ, UTC+1)
    expect(formatKickoffZurich("2026-11-02T01:20:00Z")).toBe("Mo 02.11. 02:20");
    expect(formatKickoffZurich("2026-11-01T18:00:00Z")).toBe("So 01.11. 19:00");
    expect(formatKickoffZurich("2026-10-30T00:15:00Z")).toBe("Fr 30.10. 01:15");
  });
  it("wirft bei ungültigem Zeitpunkt", () => {
    expect(() => formatKickoffZurich("nope")).toThrow(RangeError);
  });
});

describe("Wechsel der Sommerzeit EU 25.10.2026 und US 1.11.2026", () => {
  it("vor dem EU Wechsel 6 h Differenz", () => {
    // 18.10.2026 13:00 EDT = 17:00Z = 19:00 MESZ
    expect(formatTimeZurich("2026-10-18T17:00:00Z")).toBe("19:00");
  });
  it("Woche mit nur 5 h Differenz: 13:00 ET am 25.10.2026 ist 18:00 Zürich", () => {
    // EU bereits Winterzeit (UTC+1), US noch Sommerzeit (UTC-4)
    expect(formatKickoffZurich("2026-10-25T17:00:00Z")).toBe("So 25.10. 18:00");
  });
  it("nach dem US Wechsel wieder 6 h: 13:00 ET am 1.11.2026 ist 19:00 Zürich", () => {
    expect(formatKickoffZurich("2026-11-01T18:00:00Z")).toBe("So 01.11. 19:00");
  });
  it("trennt die doppelte Stunde beim EU Wechsel im Slot Schlüssel", () => {
    const a = kickoffSlotKey("2026-10-25T00:30:00Z");
    const b = kickoffSlotKey("2026-10-25T01:30:00Z");
    expect(a).toBe("2026-10-25T02:30+02:00");
    expect(b).toBe("2026-10-25T02:30+01:00");
    expect(a).not.toBe(b);
  });
});

describe("groupBySlot", () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w8.json", import.meta.url), "utf8"));
  const res = parseScoreboard(raw);
  if (!res.ok) throw new Error(res.error);
  const games = [...res.week.games].reverse();
  const slots = groupBySlot(games);

  it("gruppiert die Woche 8 in chronologische Slots", () => {
    expect(slots.map((s) => [s.label, s.games.length])).toEqual([
      ["Fr 30.10. 01:15", 1],
      ["So 01.11. 19:00", 8],
      ["So 01.11. 22:05", 1],
      ["So 01.11. 22:25", 2],
      ["Mo 02.11. 02:20", 1],
      ["Di 03.11. 02:15", 1],
    ]);
    expect(slots.reduce((n, s) => n + s.games.length, 0)).toBe(14);
    const ids = slots[1]!.games.map((g) => g.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("Sonntagnachtspiel nach Mitternacht Zürich bleibt in Woche 8 und eigenem Slot", () => {
    const snf = res.week.games.find((g) => g.id === "401873035")!;
    expect(snf.week).toBe(8);
    expect(snf.season).toBe(2026);
    const slot = slots.find((s) => s.games.some((g) => g.id === snf.id))!;
    expect(slot.slotKey).toBe("2026-11-02T02:20+01:00");
    expect(slot.label.startsWith("Mo")).toBe(true);
    expect(slot.games.every((g) => g.week === 8)).toBe(true);
    // Montagsspiel derselben NFL Woche fällt in Zürich auf Dienstag und bleibt Woche 8
    const mnf = res.week.games.find((g) => g.id === "401873036")!;
    expect(mnf.week).toBe(8);
  });

  it("leere Liste ergibt keine Slots", () => {
    expect(groupBySlot([])).toEqual([]);
  });
});
