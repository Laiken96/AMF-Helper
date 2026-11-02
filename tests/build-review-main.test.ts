import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../jobs/build-review";
import type { FetchFn } from "../jobs/fetch-schedule";
import { parseScoreboard } from "../src/core/espn";
import { ReviewFileSchema, ReviewIndexSchema } from "../src/core/review-schema";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const w8Text = read("./fixtures/espn-scoreboard-2026-w8.json");
const tipsW8 = read("../data/tips/2026-2-08.json");
const tipsW9 = read("../data/tips/2026-2-09.json");
const REVIEW = "reviews/2026-2-08.json";
const NOW = "2026-11-02T03:00:00Z";
const TUESDAY = "2026-11-03T10:00:00Z";

/** Week 8 mit allen Spielen final. MNF 401873036: Heim 26 gewinnt 27 zu 20. */
function finalW8(): string {
  const d = JSON.parse(w8Text);
  for (const e of d.events) {
    e.status.type = { ...e.status.type, name: "STATUS_FINAL", state: "post", completed: true };
    if (e.id === "401873035" || e.id === "401873036") {
      for (const c of e.competitions[0].competitors) c.score = c.homeAway === "home" ? "27" : "20";
    }
  }
  return JSON.stringify(d);
}

const current = (week: number) =>
  JSON.stringify({
    schemaVersion: 1,
    season: 2026,
    seasonType: 2,
    week,
    weekFile: `weeks/2026-2-${String(week).padStart(2, "0")}.json`,
    updatedAt: NOW,
  });

const respond = (body: string, status = 200): FetchFn => async () => new Response(body, { status });

let dir: string;
let errors: string[];
let urls: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-review-"));
  await mkdir(join(dir, "tips"));
  await mkdir(join(dir, "weeks"));
  await writeFile(join(dir, "tips/2026-2-08.json"), tipsW8);
  await writeFile(join(dir, "tips/2026-2-09.json"), tipsW9);
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
const review = async () => ReviewFileSchema.parse(JSON.parse(await readFile(join(dir, REVIEW), "utf8")));
const index = async () => ReviewIndexSchema.parse(JSON.parse(await readFile(join(dir, "reviews/index.json"), "utf8")));

describe("build-review main", () => {
  it("aktuelle Woche aus der Wochendatei ohne Abruf, Zwischenstand, Week 9 noch nicht begonnen", async () => {
    await writeFile(join(dir, "current.json"), current(8));
    const parsed = parseScoreboard(JSON.parse(w8Text), { fetchedAt: NOW });
    if (!parsed.ok) throw new Error(parsed.error);
    await writeFile(join(dir, "weeks/2026-2-08.json"), JSON.stringify(parsed.week));
    expect(await main([], deps(respond("nie", 500)))).toBe(0);
    expect(urls).toEqual([]);
    const r = await review();
    expect(r).toMatchObject({ complete: false, points: 0, tipped: 1, deviationNet: 0 });
    expect(r.tiebreakers).toEqual([
      { gameId: "401873036", slot: "monday", predictedHome: 25, predictedAway: 22, actualHome: null, actualAway: null, diff: null },
    ]);
    expect(await index()).toEqual([REVIEW]);
  });

  it("Wochenwechsel: Week 8 nicht mehr current wird per ESPN nachgeladen und komplett", async () => {
    await writeFile(join(dir, "current.json"), current(9));
    expect(await main([], deps(respond(w8Text)))).toBe(0);
    expect((await review()).complete).toBe(false);
    expect(await main([], deps(respond(finalW8()), TUESDAY))).toBe(0);
    expect(urls.every((u) => u.includes("dates=2026&seasontype=2&week=8"))).toBe(true);
    const r = await review();
    expect(r).toMatchObject({ complete: true, points: 1, tipped: 1, updatedAt: TUESDAY });
    expect(r.tiebreakers[0]).toMatchObject({ actualHome: 27, actualAway: 20, diff: 4 });
  });

  it("komplette Bilanz wird nicht erneut geladen, zweiter Lauf schreibt nicht", async () => {
    await writeFile(join(dir, "current.json"), current(9));
    await main([], deps(respond(finalW8()), TUESDAY));
    const before = await readFile(join(dir, REVIEW), "utf8");
    urls = [];
    expect(await main([], deps(respond("nie", 500), "2026-11-04T10:00:00Z"))).toBe(0);
    expect(urls).toEqual([]);
    expect(await readFile(join(dir, REVIEW), "utf8")).toBe(before);
  });

  it("unveränderter Zwischenstand schreibt nicht neu", async () => {
    await writeFile(join(dir, "current.json"), current(9));
    await main([], deps(respond(w8Text)));
    const before = await readFile(join(dir, REVIEW), "utf8");
    expect(await main([], deps(respond(w8Text), "2026-11-02T04:00:00Z"))).toBe(0);
    expect(await readFile(join(dir, REVIEW), "utf8")).toBe(before);
  });

  it("Abruffehler: Exit 1, Bilanz unverändert, Index bleibt gültig", async () => {
    await writeFile(join(dir, "current.json"), current(9));
    await main([], deps(respond(w8Text)));
    const before = await readFile(join(dir, REVIEW), "utf8");
    expect(await main([], deps(respond("boom", 500), TUESDAY))).toBe(1);
    expect(await main([], deps(respond("{}"), TUESDAY))).toBe(1);
    expect(await readFile(join(dir, REVIEW), "utf8")).toBe(before);
    expect(await index()).toEqual([REVIEW]);
    expect(errors).toHaveLength(2);
  });

  it("falsche Woche von ESPN wird abgelehnt", async () => {
    await writeFile(join(dir, "current.json"), current(9));
    expect(await main([], deps(respond(read("./fixtures/espn-scoreboard-2026-w9.json"))))).toBe(1);
    expect(errors[0]).toContain("statt 2026-2-8");
  });

  it("explizite Woche lädt immer frisch, unvollständige Argumente sind ein Fehler", async () => {
    await writeFile(join(dir, "current.json"), current(8));
    expect(await main(["--season", "2026", "--type", "2", "--week", "8"], deps(respond(finalW8()), TUESDAY))).toBe(0);
    expect(urls).toHaveLength(1);
    expect((await review()).complete).toBe(true);
    expect(await main(["--week", "8"], deps(respond(finalW8())))).toBe(1);
    expect(await main(["--season", "2026", "--type", "2", "--week", "7"], deps(respond(finalW8())))).toBe(1);
  });

  it("Index absteigend mit mehreren Wochen", async () => {
    await writeFile(join(dir, "current.json"), current(9));
    await mkdir(join(dir, "reviews"));
    await writeFile(join(dir, "reviews/2026-2-07.json"), "{}");
    await writeFile(join(dir, "reviews/2026-2-10.json"), "{}");
    await main([], deps(respond(w8Text)));
    expect(await index()).toEqual(["reviews/2026-2-10.json", REVIEW, "reviews/2026-2-07.json"]);
  });
});
