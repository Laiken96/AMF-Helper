// Playoffs und Saisonwechsel (D050): Kalender, ruhende Wochen, kommende Wochen über die Grenze zur Postseason,
// Ruhetage und Spielort im Spielplan Job, Lebenszeichen.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, upcomingWeeks, isRealTeamId, type FetchFn } from "../jobs/fetch-schedule";
import { main as heartbeatMain } from "../jobs/heartbeat";
import { parseScoreboard } from "../src/core/espn";
import { CurrentFileSchema, WeekFileSchema } from "../src/core/schema";
import { REGULAR_SEASON_WEEKS } from "../src/core/tips";
import { HeartbeatFileSchema, heartbeatDue } from "../src/core/heartbeat";
import {
  REGULAR_WEEKS,
  dormantReason,
  isTipWeek,
  nextTipWeeks,
  previousTipWeek,
  weekOrder,
} from "../src/core/season-calendar";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pre3 = read("./fixtures/espn-scoreboard-2026-t1-w3-synthetic.json");
const post1 = read("./fixtures/espn-scoreboard-2026-t3-w1-synthetic.json");
const proBowl = read("./fixtures/espn-scoreboard-2026-t3-w4-synthetic.json");
const superBowl = read("./fixtures/espn-scoreboard-2026-t3-w5-synthetic.json");
const w9 = read("./fixtures/espn-scoreboard-2026-w9.json");

/** Fixture umgeschrieben auf Typ, Woche und ein festes Datum für alle Spiele. */
function rewrite(text: string, seasonType: number, week: number, date?: string, idSuffix = ""): string {
  const raw = JSON.parse(text);
  raw.season.type = seasonType;
  raw.week.number = week;
  for (const e of raw.events) {
    e.season = { ...e.season, type: seasonType };
    e.week = { number: week };
    if (date) e.date = date;
    e.id = `${e.id}${idSuffix}`;
  }
  return JSON.stringify(raw);
}

function weekFile(text: string): string {
  const parsed = parseScoreboard(JSON.parse(text), { fetchedAt: "2026-11-02T00:00:00Z" });
  if (!parsed.ok) throw new Error(parsed.error);
  return JSON.stringify(parsed.week);
}

const respond = (body: string, status = 200): FetchFn => async () => new Response(body, { status });

let dir: string;
let errors: string[];
let logs: string[];
let urls: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-season-"));
  await mkdir(join(dir, "weeks"));
  errors = [];
  logs = [];
  urls = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Ohne Query Parameter week die aktuelle Woche, sonst nach Woche aus der Tabelle, fehlend HTTP 500. */
const router = (current: string, byWeek: Record<string, string> = {}): FetchFn => async (url) => {
  urls.push(url);
  const q = new URL(url).searchParams;
  const week = q.get("week");
  if (week === null) return new Response(current);
  const body = byWeek[`${q.get("seasontype")}-${week}`];
  return body === undefined ? new Response("fehlt", { status: 500 }) : new Response(body);
};

const deps = (fetch: FetchFn) => ({
  fetch,
  dataDir: dir,
  now: () => "2026-11-02T02:00:00Z",
  log: (m: string) => logs.push(m),
  error: (m: string) => errors.push(m),
});

const currentJson = (seasonType: number, week: number) =>
  JSON.stringify({
    schemaVersion: 1,
    season: 2026,
    seasonType,
    week,
    weekFile: `weeks/2026-${seasonType}-${String(week).padStart(2, "0")}.json`,
    updatedAt: "2026-11-01T00:00:00Z",
  });

const readWeek = async (p: string) => WeekFileSchema.parse(JSON.parse(await readFile(join(dir, p), "utf8")));
const readCurrent = async () => CurrentFileSchema.parse(JSON.parse(await readFile(join(dir, "current.json"), "utf8")));

describe("Saisonkalender", () => {
  it("Regular Season Länge stimmt mit tips.ts überein", () => {
    expect(REGULAR_WEEKS).toBe(REGULAR_SEASON_WEEKS);
  });

  it("Tippwochen und ruhende Wochen", () => {
    expect(dormantReason({ seasonType: 1, week: 3 })).toBe("Preseason");
    expect(dormantReason({ seasonType: 3, week: 4 })).toBe("Pro Bowl");
    expect(dormantReason({ seasonType: 4, week: 1 })).toBe("Offseason");
    expect(dormantReason({ seasonType: 2, week: 19 })).toMatch(/unbekannt/);
    for (const k of [{ seasonType: 2, week: 1 }, { seasonType: 2, week: 18 }, { seasonType: 3, week: 1 }, { seasonType: 3, week: 5 }]) {
      expect(isTipWeek(k)).toBe(true);
    }
  });

  it("Vorwoche über die Grenze zur Postseason und am Pro Bowl vorbei", () => {
    expect(previousTipWeek({ season: 2026, seasonType: 2, week: 1 })).toBeNull();
    expect(previousTipWeek({ season: 2026, seasonType: 2, week: 9 })).toEqual({ season: 2026, seasonType: 2, week: 8 });
    expect(previousTipWeek({ season: 2026, seasonType: 3, week: 1 })).toEqual({ season: 2026, seasonType: 2, week: 18 });
    expect(previousTipWeek({ season: 2026, seasonType: 3, week: 5 })).toEqual({ season: 2026, seasonType: 3, week: 3 });
    expect(previousTipWeek({ season: 2026, seasonType: 3, week: 4 })).toBeNull();
    expect(weekOrder({ seasonType: 3, week: 1 })).toBeGreaterThan(weekOrder({ seasonType: 2, week: 18 }));
  });

  it("kommende Wochen über die Grenze, ohne Pro Bowl, aus der Preseason Week 1 und 2", () => {
    const k = (seasonType: number, week: number) => ({ season: 2026, seasonType, week });
    expect(upcomingWeeks(k(2, 9))).toEqual([k(2, 10), k(2, 11)]);
    expect(upcomingWeeks(k(2, 17))).toEqual([k(2, 18), k(3, 1)]);
    expect(upcomingWeeks(k(2, 18))).toEqual([k(3, 1), k(3, 2)]);
    expect(upcomingWeeks(k(3, 2))).toEqual([k(3, 3), k(3, 5)]);
    expect(upcomingWeeks(k(3, 3))).toEqual([k(3, 5)]);
    expect(upcomingWeeks(k(3, 4))).toEqual([k(3, 5)]);
    expect(upcomingWeeks(k(3, 5))).toEqual([]);
    expect(upcomingWeeks(k(1, 3))).toEqual([k(2, 1), k(2, 2)]);
    expect(upcomingWeeks(k(4, 1))).toEqual([]);
    expect(nextTipWeeks(k(2, 9), 0)).toEqual([]);
  });

  it("Platzhalter IDs offener Paarungen", () => {
    expect(isRealTeamId("26")).toBe(true);
    expect(isRealTeamId("-1")).toBe(false);
    expect(isRealTeamId("TBD")).toBe(false);
    expect(isRealTeamId("0")).toBe(false);
  });
});

describe("Spielplan Job im Saisonwechsel", () => {
  it("Preseason Typ 1: keine Wochendatei, current.json bleibt, Regular Week 1 und 2 als kommende Wochen", async () => {
    await writeFile(join(dir, "current.json"), currentJson(3, 5));
    const before = await readFile(join(dir, "current.json"), "utf8");
    const fetch = router(pre3, { "2-1": rewrite(w9, 2, 1, "2026-09-13T17:00Z", "1"), "2-2": rewrite(w9, 2, 2, "2026-09-20T17:00Z", "2") });
    expect(await main([], deps(fetch))).toBe(0);
    expect(logs.join("\n")).toMatch(/Preseason, ruhende Woche/);
    expect(await readFile(join(dir, "current.json"), "utf8")).toBe(before);
    expect((await readdir(join(dir, "weeks"))).sort()).toEqual(["2026-2-01.json", "2026-2-02.json"]);
    // Regular Week 1 hat keine Vorwoche, also keine Ruhetage.
    expect((await readWeek("weeks/2026-2-01.json")).games[0]).not.toHaveProperty("homeRest");
    expect((await readWeek("weeks/2026-2-02.json")).games[0]?.homeRest).toBe(7);
  });

  it("Offseason Typ 4 ohne Spiele: nichts geschrieben, Exit 0", async () => {
    await writeFile(join(dir, "current.json"), currentJson(3, 5));
    const off = JSON.parse(rewrite(superBowl, 4, 1));
    off.events = [];
    expect(await main([], deps(router(JSON.stringify(off))))).toBe(0);
    expect(await readdir(join(dir, "weeks"))).toEqual([]);
    expect((await readCurrent()).seasonType).toBe(3);
    expect(urls).toHaveLength(1);
  });

  it("explizit gewählte Preseason Woche wird geschrieben, current.json bleibt", async () => {
    await writeFile(join(dir, "current.json"), currentJson(2, 18));
    expect(await main(["--season", "2026", "--type", "1", "--week", "3"], deps(respond(pre3)))).toBe(0);
    expect((await readWeek("weeks/2026-1-03.json")).games).toHaveLength(3);
    expect((await readCurrent()).seasonType).toBe(2);
  });

  it("Postseason Week 1 nach Week 18: current.json wechselt, Ruhetage aus Week 18, offene Paarungen später", async () => {
    await writeFile(join(dir, "weeks/2026-2-18.json"), weekFile(rewrite(w9, 2, 18, "2027-01-03T18:00Z")));
    await writeFile(join(dir, "weeks/2026-2-17.json"), weekFile(rewrite(w9, 2, 17, "2026-12-27T18:00Z")));
    const div = JSON.parse(rewrite(post1, 3, 2));
    div.events = div.events.slice(0, 4);
    div.events[3].competitions[0].competitors[0].team = { id: "-1", abbreviation: "TBD", displayName: "TBD", shortDisplayName: "TBD" };
    const conf = JSON.parse(rewrite(post1, 3, 3));
    conf.events = [];
    const fetch = router(post1, { "3-2": JSON.stringify(div), "3-3": JSON.stringify(conf) });
    expect(await main([], deps(fetch))).toBe(0);
    expect(errors).toEqual([]);
    expect(await readCurrent()).toMatchObject({ seasonType: 3, week: 1, weekFile: "weeks/2026-3-01.json" });
    const week = await readWeek("weeks/2026-3-01.json");
    expect(week.schemaVersion).toBe(2);
    expect(week.games).toHaveLength(6);
    // Samstag 9.1. gegen Sonntag 3.1.: 6 Tage, Montag 11.1. abends New York: 8 Tage.
    const byKick = new Map(week.games.map((g) => [g.kickoffUtc, g]));
    expect(byKick.get("2027-01-09T21:30:00Z")).toMatchObject({ homeRest: 6, awayRest: 6 });
    expect(byKick.get("2027-01-12T01:15:00Z")).toMatchObject({ homeRest: 8, awayRest: 8 });
    expect(logs.join("\n")).toMatch(/2026-3-2: Paarung .* noch offen/);
    expect(logs.join("\n")).toMatch(/2026-3-3: noch keine Spiele/);
    expect((await readdir(join(dir, "weeks"))).sort()).toEqual(["2026-2-17.json", "2026-2-18.json", "2026-3-01.json"]);
  });

  it("Postseason Schemafehler einer noch nicht angesetzten Woche macht den Lauf nicht rot", async () => {
    const fetch = router(post1, { "3-2": '{"events":[]}', "3-3": '{"events":[]}' });
    expect(await main([], deps(fetch))).toBe(0);
    expect(logs.join("\n")).toMatch(/noch nicht angesetzt/);
  });

  it("Pro Bowl Woche 4: ruht, current.json bleibt auf der Conference Woche, Super Bowl als kommende Woche", async () => {
    await writeFile(join(dir, "current.json"), currentJson(3, 3));
    await writeFile(join(dir, "weeks/2026-3-03.json"), weekFile(rewrite(post1, 3, 3, "2027-01-25T20:00Z")));
    const before = await readFile(join(dir, "current.json"), "utf8");
    expect(await main([], deps(router(proBowl, { "3-5": superBowl })))).toBe(0);
    expect(logs.join("\n")).toMatch(/Pro Bowl, ruhende Woche/);
    expect(await readFile(join(dir, "current.json"), "utf8")).toBe(before);
    expect((await readdir(join(dir, "weeks"))).sort()).toEqual(["2026-3-03.json", "2026-3-05.json"]);
    expect(urls.some((u) => u.includes("seasontype=3&week=4"))).toBe(false);
    const sb = (await readWeek("weeks/2026-3-05.json")).games[0]!;
    expect(sb).toMatchObject({
      neutralSite: true,
      venue: "SoFi Stadium",
      venueInfo: { name: "SoFi Stadium", city: "Inglewood", country: "USA" },
      homeRest: 20,
      awayRest: 20,
    });
  });

  it("Super Bowl Woche 5 als aktuelle Woche: wird geschrieben, keine kommenden Wochen", async () => {
    expect(await main([], deps(router(superBowl)))).toBe(0);
    expect(urls).toHaveLength(1);
    expect(await readCurrent()).toMatchObject({ seasonType: 3, week: 5 });
  });
});

describe("Lebenszeichen", () => {
  it("fällig ohne Datei und nach 30 Tagen, sonst nicht", () => {
    expect(heartbeatDue(undefined, "2027-03-01T00:00:00Z")).toBe(true);
    expect(heartbeatDue({ schemaVersion: 1, updatedAt: "2027-02-01T00:00:00Z" }, "2027-03-02T23:59:59Z")).toBe(false);
    expect(heartbeatDue({ schemaVersion: 1, updatedAt: "2027-02-01T00:00:00Z" }, "2027-03-03T00:00:00Z")).toBe(true);
    expect(heartbeatDue({ kaputt: true }, "2027-03-01T00:00:00Z")).toBe(true);
  });

  it("Job schreibt nur, wenn fällig", async () => {
    const run = (now: string) => heartbeatMain([], { dataDir: dir, now: () => now, log: () => {}, error: (m) => errors.push(m) });
    expect(await run("2027-03-01T00:00:00Z")).toBe(0);
    const first = await readFile(join(dir, "heartbeat.json"), "utf8");
    expect(HeartbeatFileSchema.parse(JSON.parse(first)).updatedAt).toBe("2027-03-01T00:00:00Z");
    expect(await run("2027-03-15T00:00:00Z")).toBe(0);
    expect(await readFile(join(dir, "heartbeat.json"), "utf8")).toBe(first);
    expect(await run("2027-04-01T00:00:00Z")).toBe(0);
    expect(JSON.parse(await readFile(join(dir, "heartbeat.json"), "utf8")).updatedAt).toBe("2027-04-01T00:00:00Z");
    expect(await heartbeatMain(["--x"], { dataDir: dir, error: () => {} })).toBe(1);
  });
});
