import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WeeksIndexSchema } from "../src/core/extra-schema";
import { buildWeeksIndex, parseWeekFileName } from "../src/core/weeks-index";
import { main } from "../jobs/weeks-index";

describe("Wochenindex Logik", () => {
  it("liest Dateinamen", () => {
    expect(parseWeekFileName("2026-2-09.json")).toEqual({ season: 2026, seasonType: 2, week: 9 });
    expect(parseWeekFileName("index.json")).toBeNull();
    expect(parseWeekFileName("2026-2-9.json")).toBeNull();
  });

  it("aufsteigend, ohne Duplikate, Pfade nur bei vorhandener Datei", () => {
    const have = new Set(["tips/2026-2-09.json", "reviews/2026-2-08.json", "opinions/2026-2-09.json"]);
    const idx = buildWeeksIndex(
      [
        { season: 2026, seasonType: 2, week: 10 },
        { season: 2026, seasonType: 2, week: 8 },
        { season: 2026, seasonType: 2, week: 9 },
        { season: 2026, seasonType: 2, week: 9 },
        { season: 2025, seasonType: 3, week: 1 },
      ],
      (p) => have.has(p),
      "2026-11-02T12:00:00Z",
    );
    expect(idx.weeks.map((w) => `${w.season}-${w.seasonType}-${w.week}`)).toEqual(["2025-3-1", "2026-2-8", "2026-2-9", "2026-2-10"]);
    expect(idx.weeks[2]).toEqual({
      season: 2026,
      seasonType: 2,
      week: 9,
      weekFile: "weeks/2026-2-09.json",
      tipsFile: "tips/2026-2-09.json",
      reviewFile: null,
      opinionFile: "opinions/2026-2-09.json",
    });
    expect(idx.weeks[1]!.reviewFile).toBe("reviews/2026-2-08.json");
  });
});

describe("weeks-index main", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nfl-index-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const deps = (now: string) => ({ dataDir: dir, now: () => now, log: () => {}, error: () => {} });

  it("schreibt Index aus vorhandenen Dateien, unverändert ohne neue Datei", async () => {
    for (const sub of ["weeks", "tips", "reviews"]) await mkdir(join(dir, sub), { recursive: true });
    await writeFile(join(dir, "weeks/2026-2-08.json"), "{}");
    await writeFile(join(dir, "weeks/2026-2-09.json"), "{}");
    await writeFile(join(dir, "tips/2026-2-08.json"), "{}");
    await writeFile(join(dir, "reviews/index.json"), "[]");
    expect(await main([], deps("2026-11-02T12:00:00Z"))).toBe(0);
    const text = await readFile(join(dir, "weeks/index.json"), "utf8");
    const idx = WeeksIndexSchema.parse(JSON.parse(text));
    expect(idx.weeks).toHaveLength(2);
    expect(idx.weeks[0]!.tipsFile).toBe("tips/2026-2-08.json");
    expect(idx.weeks[1]!.tipsFile).toBeNull();
    expect(await main([], deps("2026-11-02T13:00:00Z"))).toBe(0);
    expect(await readFile(join(dir, "weeks/index.json"), "utf8")).toBe(text);
    await writeFile(join(dir, "tips/2026-2-09.json"), "{}");
    expect(await main([], deps("2026-11-02T14:00:00Z"))).toBe(0);
    const next = WeeksIndexSchema.parse(JSON.parse(await readFile(join(dir, "weeks/index.json"), "utf8")));
    expect(next.weeks[1]!.tipsFile).toBe("tips/2026-2-09.json");
    expect(next.updatedAt).toBe("2026-11-02T14:00:00Z");
  });

  it("ohne Wochen ein leerer Index", async () => {
    expect(await main([], deps("2026-11-02T12:00:00Z"))).toBe(0);
    expect(WeeksIndexSchema.parse(JSON.parse(await readFile(join(dir, "weeks/index.json"), "utf8"))).weeks).toEqual([]);
  });
});
