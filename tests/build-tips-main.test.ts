import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../jobs/build-tips";
import type { FetchFn } from "../jobs/fetch-schedule";
import { TipsFileSchema } from "../src/core/tips-schema";

const fixtureText = readFileSync(new URL("./fixtures/espn-scoreboard-2026-w9.json", import.meta.url), "utf8");
const standingsText = readFileSync(new URL("../data/standings.json", import.meta.url), "utf8");
const TIPS = "tips/2026-2-09.json";
const NOW = "2026-11-02T03:00:00Z";
const CURRENT_W9 = JSON.stringify({
  schemaVersion: 1,
  season: 2026,
  seasonType: 2,
  week: 9,
  weekFile: "weeks/2026-2-09.json",
  updatedAt: NOW,
});

const respond = (body: string, status = 200): FetchFn => async () => new Response(body, { status });

let dir: string;
let errors: string[];
let urls: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-tips-"));
  await writeFile(join(dir, "standings.json"), standingsText);
  await writeFile(join(dir, "current.json"), CURRENT_W9);
  errors = [];
  urls = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (fetch: FetchFn, now = NOW) => ({
  fetch: (async (url, init) => {
    urls.push(url);
    return fetch(url, init);
  }) as FetchFn,
  dataDir: dir,
  now: () => now,
  log: () => {},
  error: (m: string) => errors.push(m),
});
const read = () => readFile(join(dir, TIPS), "utf8");

describe("build-tips main", () => {
  it("erzeugt eine gültige Datei für Week 9", async () => {
    expect(await main(["--season", "2026", "--type", "2", "--week", "9"], deps(respond(fixtureText)))).toBe(0);
    expect(urls[0]).toContain("dates=2026&seasontype=2&week=9");
    const f = TipsFileSchema.parse(JSON.parse(await read()));
    expect(f.tips).toHaveLength(15);
    // D026: JA 45, Ziel CZ 51, 6 Punkte auf 10 Restwochen ergibt 0
    expect(f.maxDeviations).toBe(2);
    expect(f.tips.filter((t) => t.deviation)).toHaveLength(2);
    expect(f.tiebreakers.map((t) => [t.slot, t.gameId])).toEqual([
      ["thursday", "401873037"],
      ["monday", "401873051"],
    ]);
  });

  it("ohne Argumente Woche aus current.json, zweiter Lauf schreibt nicht", async () => {
    expect(await main([], deps(respond(fixtureText)))).toBe(0);
    expect(urls[0]).toContain("dates=2026&seasontype=2&week=9");
    const first = await read();
    expect(await main([], deps(respond(fixtureText), "2026-11-02T04:00:00Z"))).toBe(0);
    expect(await read()).toBe(first);
  });

  it("Abruffehler: Exit 1, Datei unverändert", async () => {
    await main([], deps(respond(fixtureText)));
    const before = await read();
    expect(await main([], deps(respond("boom", 500)))).toBe(1);
    expect(await main([], deps(respond("{}")))).toBe(1);
    expect(await read()).toBe(before);
    expect(errors.length).toBe(2);
  });

  it("D019: weniger Spiele ohne explizite Woche abgelehnt, explizit erlaubt", async () => {
    await main([], deps(respond(fixtureText)));
    const before = await read();
    const shrunk = JSON.parse(fixtureText);
    shrunk.events = shrunk.events.slice(0, 3);
    expect(await main([], deps(respond(JSON.stringify(shrunk))))).toBe(1);
    expect(errors[0]).toContain("nicht überschrieben");
    expect(await read()).toBe(before);
    expect(await main(["--season", "2026", "--type", "2", "--week", "9"], deps(respond(JSON.stringify(shrunk))))).toBe(0);
    expect(TipsFileSchema.parse(JSON.parse(await read())).tips).toHaveLength(3);
  });

  it("gesperrte Tipps bleiben trotz neuer Quote unverändert", async () => {
    await main([], deps(respond(fixtureText)));
    const changed = JSON.parse(fixtureText);
    const odds = changed.events[0].competitions[0].odds[0];
    odds.spread = 20;
    odds.details = "BAL -20";
    odds.homeTeamOdds.favorite = true;
    odds.awayTeamOdds.favorite = false;
    const afterThu = "2026-11-06T02:00:00Z";
    expect(await main([], deps(respond(JSON.stringify(changed)), afterThu))).toBe(0);
    const f = TipsFileSchema.parse(JSON.parse(await read()));
    const thu = f.tips.find((t) => t.gameId === "401873037")!;
    expect(thu).toMatchObject({ locked: true, lockedAt: afterThu, pickTeamId: "30" });
    expect(thu.odds!.spreadHome).toBe(8.5);
  });

  it("fehlende Rangliste oder kaputte Tippdatei: Exit 1", async () => {
    await rm(join(dir, "standings.json"));
    expect(await main([], deps(respond(fixtureText)))).toBe(1);
    await writeFile(join(dir, "standings.json"), standingsText);
    await mkdir(join(dir, "tips"), { recursive: true });
    await writeFile(join(dir, TIPS), "{kaputt");
    expect(await main([], deps(respond(fixtureText)))).toBe(1);
    expect(await read()).toBe("{kaputt");
  });

  it("leere Woche ohne bestehende Datei", async () => {
    const empty = JSON.parse(fixtureText);
    empty.events = [];
    expect(await main([], deps(respond(JSON.stringify(empty))))).toBe(0);
    const f = TipsFileSchema.parse(JSON.parse(await read()));
    expect(f.tips).toEqual([]);
    expect(f.tiebreakers).toEqual([]);
  });

  it("fehlende current.json ohne Argumente: Exit 1, kein Abruf", async () => {
    await rm(join(dir, "current.json"));
    expect(await main([], deps(respond(fixtureText)))).toBe(1);
    expect(urls).toEqual([]);
    expect(errors[0]).toContain("current.json");
    expect(await main(["--season", "2026", "--type", "2", "--week", "9"], deps(respond(fixtureText)))).toBe(0);
  });

  it("ungültige Argumente", async () => {
    expect(await main(["--foo"], deps(respond(fixtureText)))).toBe(1);
  });
});
