import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CurrentFileSchema,
  SettingsFileSchema,
  TeamsFileSchema,
  WeekFileSchema,
} from "../src/core/schema";
import { buildOutputs, parseCliArgs, readExisting, writeFiles } from "../jobs/schedule-lib";

const fixture = () =>
  JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w8.json", import.meta.url), "utf8"));
const WEEK_PATH = "weeks/2026-2-08.json";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-data-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(raw: unknown, now: string, updateCurrent = true) {
  const existing = await readExisting(dir, WEEK_PATH);
  const res = buildOutputs({ raw, now, updateCurrent, existing });
  if (res.ok) await writeFiles(dir, res.files);
  return res;
}

const readJson = async (p: string) => JSON.parse(await readFile(join(dir, p), "utf8"));

describe("Job Ausgabe", () => {
  it("erzeugte Dateien bestehen die Schemas", async () => {
    const res = await run(fixture(), "2026-11-02T02:00:00Z");
    expect(res.ok).toBe(true);
    const teams = TeamsFileSchema.parse(await readJson("teams.json"));
    const week = WeekFileSchema.parse(await readJson(WEEK_PATH));
    const current = CurrentFileSchema.parse(await readJson("current.json"));
    const settings = SettingsFileSchema.parse(await readJson("settings.json"));
    expect(teams.teams).toHaveLength(32);
    expect(week.games).toHaveLength(14);
    expect(current).toMatchObject({ season: 2026, seasonType: 2, week: 8, weekFile: WEEK_PATH });
    expect(settings.lockMode).toBe("per_kickoff");
    const text = await readFile(join(dir, "teams.json"), "utf8");
    expect(text.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect((await readdir(join(dir, "weeks"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("schreibt bei gleichem Inhalt nichts neu, nur Zeitstempel zählen nicht", async () => {
    await run(fixture(), "2026-11-02T02:00:00Z");
    const before = await readFile(join(dir, WEEK_PATH), "utf8");
    const res = await run(fixture(), "2026-11-02T03:00:00Z");
    if (!res.ok) throw new Error(res.error);
    expect(res.files).toEqual([]);
    expect(await readFile(join(dir, WEEK_PATH), "utf8")).toBe(before);

    const changed = fixture();
    changed.events[0].competitions[0].competitors[0].score = "10";
    const res2 = await run(changed, "2026-11-02T04:00:00Z");
    if (!res2.ok) throw new Error(res2.error);
    expect(res2.files.map((f) => f.path)).toEqual([WEEK_PATH]);
    expect((await readJson(WEEK_PATH)).fetchedAt).toBe("2026-11-02T04:00:00Z");
  });

  it("überschreibt eine bestehende settings.json nicht", async () => {
    await writeFile(join(dir, "settings.json"), '{"schemaVersion":1,"lockMode":"weekly","timezone":"Europe/Zurich"}');
    await run(fixture(), "2026-11-02T02:00:00Z");
    expect((await readJson("settings.json")).lockMode).toBe("weekly");
  });

  it("lässt bei Schemafehler bestehende Dateien unangetastet", async () => {
    await run(fixture(), "2026-11-02T02:00:00Z");
    const before = await readFile(join(dir, WEEK_PATH), "utf8");
    const broken = fixture();
    delete broken.events;
    const res = await run(broken, "2026-11-02T05:00:00Z");
    expect(res.ok).toBe(false);
    expect(await readFile(join(dir, WEEK_PATH), "utf8")).toBe(before);
  });

  it("leere Woche ohne Vorgänger schreibt gültige Datei mit 0 Spielen", async () => {
    const empty = fixture();
    empty.events = [];
    delete empty.week.teamsOnBye;
    const res = await run(empty, "2026-11-02T06:00:00Z");
    if (!res.ok) throw new Error(res.error);
    expect(WeekFileSchema.parse(await readJson(WEEK_PATH)).games).toEqual([]);
  });

  it("leere Antwort überschreibt bestehende nicht leere Woche nicht", async () => {
    await run(fixture(), "2026-11-02T02:00:00Z");
    const before = await readFile(join(dir, WEEK_PATH), "utf8");
    const empty = fixture();
    empty.events = [];
    const res = await run(empty, "2026-11-02T06:00:00Z");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("keine Spiele");
    expect(await readFile(join(dir, WEEK_PATH), "utf8")).toBe(before);
  });

  it("Antwort mit fehlenden Spiel IDs überschreibt bestehende Woche nicht", async () => {
    await run(fixture(), "2026-11-02T02:00:00Z");
    const before = await readFile(join(dir, WEEK_PATH), "utf8");
    const partial = fixture();
    const removed = partial.events.splice(0, 2).map((e: { id: string }) => e.id);
    const res = await run(partial, "2026-11-02T06:00:00Z");
    expect(res.ok).toBe(false);
    if (!res.ok) for (const id of removed) expect(res.error).toContain(id);
    expect(await readFile(join(dir, WEEK_PATH), "utf8")).toBe(before);
  });

  it("explizit gewählte Woche darf schrumpfen und behält bekannte Teams", async () => {
    await run(fixture(), "2026-11-02T02:00:00Z");
    const empty = fixture();
    empty.events = [];
    delete empty.week.teamsOnBye;
    const existing = await readExisting(dir, WEEK_PATH);
    const res = buildOutputs({ raw: empty, now: "2026-11-02T06:00:00Z", updateCurrent: false, allowShrink: true, existing });
    if (!res.ok) throw new Error(res.error);
    await writeFiles(dir, res.files);
    expect(WeekFileSchema.parse(await readJson(WEEK_PATH)).games).toEqual([]);
    expect(TeamsFileSchema.parse(await readJson("teams.json")).teams).toHaveLength(32);
  });
});

describe("CurrentFileSchema.weekFile", () => {
  const base = { schemaVersion: 1, season: 2026, seasonType: 2, week: 8, updatedAt: "2026-11-02T02:00:00Z" };
  it("akzeptiert den Pfad aus weekFilePath", () => {
    expect(CurrentFileSchema.safeParse({ ...base, weekFile: "weeks/2026-2-08.json" }).success).toBe(true);
  });
  it("lehnt fremde Pfade ab", () => {
    for (const weekFile of ["../secret.json", "weeks/2026-2-8.json", "/weeks/2026-2-08.json", "weeks/2026-2-08.json.bak"]) {
      expect(CurrentFileSchema.safeParse({ ...base, weekFile }).success).toBe(false);
    }
  });
});

describe("parseCliArgs", () => {
  it("liest Saison, Typ und Woche", () => {
    expect(parseCliArgs(["--season", "2026", "--type=2", "--week", "8"])).toEqual({ season: 2026, seasonType: 2, week: 8 });
    expect(parseCliArgs([])).toEqual({});
  });
  it("lehnt Unbekanntes ab", () => {
    expect(() => parseCliArgs(["--foo"])).toThrow();
    expect(() => parseCliArgs(["--week", "x"])).toThrow();
  });
});
