import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION, type CurrentFile } from "../src/core/schema";
import type { WeeksIndex } from "../src/core/extra-schema";
import {
  compareRef,
  loadCurrent,
  navWeeks,
  parseWeekKey,
  phaseOf,
  resetDataCacheForTests,
  retryLoad,
  revalidateData,
  weekKey,
  weekPaths,
  type WeekNav,
} from "../src/app/data";

const current: CurrentFile = {
  schemaVersion: SCHEMA_VERSION,
  season: 2026,
  seasonType: 2,
  week: 9,
  weekFile: "weeks/2026-2-09.json",
  updatedAt: "2026-11-02T20:00:00Z",
};

const indexEntry = (week: number, review: boolean) => ({
  season: 2026,
  seasonType: 2,
  week,
  weekFile: `weeks/2026-2-${String(week).padStart(2, "0")}.json`,
  tipsFile: `tips/2026-2-${String(week).padStart(2, "0")}.json`,
  reviewFile: review ? `reviews/2026-2-${String(week).padStart(2, "0")}.json` : null,
  opinionFile: null,
});

const index = { schemaVersion: 1, updatedAt: "2026-11-02T20:00:00Z", weeks: [indexEntry(8, true), indexEntry(9, false)] } as WeeksIndex;

describe("Wochenschlüssel", () => {
  it("weekKey und parseWeekKey sind umkehrbar", () => {
    expect(weekKey({ season: 2026, seasonType: 2, week: 9 })).toBe("2026-2-09");
    expect(parseWeekKey("2026-2-09")).toEqual({ season: 2026, seasonType: 2, week: 9 });
    expect(parseWeekKey("2026-3-1")).toEqual({ season: 2026, seasonType: 3, week: 1 });
  });

  it("parseWeekKey lehnt Ungültiges ab", () => {
    for (const v of [null, undefined, "", "2026-4-01", "2026-2-100", "26-2-09", "2026-2-09x"]) expect(parseWeekKey(v)).toBeNull();
  });

  it("compareRef und phaseOf", () => {
    const c = { season: 2026, seasonType: 2, week: 9 };
    expect(compareRef({ season: 2025, seasonType: 3, week: 4 }, c)).toBeLessThan(0);
    expect(phaseOf({ season: 2026, seasonType: 2, week: 8 }, c)).toBe("vergangen");
    expect(phaseOf(c, c)).toBe("aktuell");
    expect(phaseOf({ season: 2026, seasonType: 3, week: 1 }, c)).toBe("kommend");
  });
});

describe("weekPaths und navWeeks", () => {
  const nav = (over: Partial<WeekNav>): WeekNav => ({ current, index, ref: { season: 2026, seasonType: 2, week: 9 }, phase: "aktuell", ...over });

  it("weekPaths nutzt den Index, sonst die Namenskonvention", () => {
    expect(weekPaths(index, { season: 2026, seasonType: 2, week: 8 })).toEqual({
      listed: true,
      weekFile: "weeks/2026-2-08.json",
      tipsFile: "tips/2026-2-08.json",
      reviewFile: "reviews/2026-2-08.json",
    });
    expect(weekPaths(null, { season: 2026, seasonType: 2, week: 10 })).toEqual({
      listed: false,
      weekFile: "weeks/2026-2-10.json",
      tipsFile: "tips/2026-2-10.json",
      reviewFile: null,
    });
  });

  it("ohne Index in der aktuellen Woche kein Wähler", () => {
    expect(navWeeks(nav({ index: null }))).toBeNull();
  });

  it("ohne Index in einer anderen Woche: aktuelle und gewählte Woche", () => {
    expect(navWeeks(nav({ index: null, ref: { season: 2026, seasonType: 2, week: 11 }, phase: "kommend" }))).toEqual([
      { season: 2026, seasonType: 2, week: 9 },
      { season: 2026, seasonType: 2, week: 11 },
    ]);
  });

  it("mit Index aufsteigend, gewählte Woche ergänzt", () => {
    expect(navWeeks(nav({ ref: { season: 2026, seasonType: 2, week: 7 }, phase: "vergangen" }))?.map((w) => w.week)).toEqual([7, 8, 9]);
  });
});

describe("Erholung nach Ladefehler", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  let events = 0;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetDataCacheForTests();
    events = 0;
    const win = new EventTarget();
    win.addEventListener("nfl-data-refresh", () => (events += 1));
    vi.stubGlobal("window", win);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revalidateData lädt fehlgeschlagene Dateien neu und meldet die Änderung", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await loadCurrent()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(ok(current));
    expect(await revalidateData()).toBe(true);
    expect(events).toBe(1);

    // Danach aus dem Cache, ohne neuen Abruf
    expect(await loadCurrent()).toEqual(current);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("weiterhin fehlgeschlagen: keine Änderung, nächster Versuch bleibt vorgemerkt", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    expect(await loadCurrent()).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 503 }));
    expect(await revalidateData()).toBe(false);
    expect(events).toBe(0);
    fetchMock.mockResolvedValueOnce(ok(current));
    expect(await revalidateData()).toBe(true);
    expect(events).toBe(1);
  });

  it("Zeitüberschreitung lässt revalidateData nicht hängen", async () => {
    const timeout = () => Promise.reject(new DOMException("Zeitüberschreitung", "TimeoutError"));
    fetchMock.mockImplementationOnce(timeout);
    expect(await loadCurrent()).toBeNull();
    fetchMock.mockImplementationOnce(timeout);
    expect(await revalidateData()).toBe(false);
    // Neuer Durchgang startet, also ist der vorige beendet
    fetchMock.mockResolvedValueOnce(ok(current));
    expect(await revalidateData()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("geladene Dateien ersetzen den Cache nur bei geändertem Inhalt", async () => {
    fetchMock.mockResolvedValueOnce(ok(current));
    expect(await loadCurrent()).toEqual(current);
    fetchMock.mockResolvedValueOnce(ok(current));
    expect(await revalidateData()).toBe(false);
    expect(events).toBe(0);
    const next = { ...current, week: 10, weekFile: "weeks/2026-2-10.json" };
    fetchMock.mockResolvedValueOnce(ok(next));
    expect(await revalidateData()).toBe(true);
    expect(await loadCurrent()).toEqual(next);
  });

  it("retryLoad lässt die Ansichten auch ohne Änderung neu laden", async () => {
    fetchMock.mockResolvedValueOnce(ok(current));
    await loadCurrent();
    fetchMock.mockResolvedValueOnce(ok(current));
    await retryLoad();
    expect(events).toBe(1);
  });

  it("retryLoad bei weiterhin fehlgeschlagener Datei: kein zweiter Abruf über die Ansichten", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await loadCurrent();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await retryLoad();
    expect(events).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(ok(current));
    await retryLoad();
    expect(events).toBe(1);
  });

  it("Fehlermeldung bei Zeitüberschreitung", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Zeitüberschreitung", "TimeoutError"));
    const { loadWeekData } = await import("../src/app/data");
    await expect(loadWeekData()).rejects.toThrow(/Zeitüberschreitung beim Laden von current.json/);
  });
});
