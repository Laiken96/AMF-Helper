// Abgleich Rangliste gegen App Tipps, Wochenpunkte über die Saisontyp Grenze, Saison der Rangliste,
// Rückwärtskompatibilität der Schemas, Spielort und Ruhetage (D050).
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main as reviewMain } from "../jobs/build-review";
import type { FetchFn } from "../jobs/fetch-schedule";
import { parseScoreboard } from "../src/core/espn";
import { rankingCheck, withRankingCheck } from "../src/core/review";
import { ReviewFileSchema, StandingsHistorySchema, type ReviewFile, type StandingsHistory } from "../src/core/review-schema";
import { WeekFileSchema, type Game } from "../src/core/schema";
import {
  StandingsFileSchema,
  applyReport,
  baseEntry,
  groupWeekRows,
  reportedWeekPoints,
  standingsAppliesTo,
} from "../src/core/standings";
import { newYorkDayNumber, restDays, withRestDays } from "../src/core/time";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const NOW = "2027-01-20T10:00:00Z";

const players = (pts: [number, number, number, number, number]) =>
  (["MS", "LM", "DH", "CZ", "JA"] as const).map((id, i) => ({ id, points: pts[i]! }));
const entry = (seasonType: number, week: number, pts: [number, number, number, number, number], season = 2026) => ({
  season,
  seasonType,
  week,
  reportedAt: NOW,
  players: players(pts),
});
const hist = (...entries: ReturnType<typeof entry>[]): StandingsHistory => ({ schemaVersion: 1, entries });

describe("Wochenpunkte über die Saisontyp Grenze", () => {
  const h = hist(entry(2, 17, [150, 148, 140, 120, 130]), entry(2, 18, [160, 157, 150, 128, 141]), entry(3, 1, [164, 160, 155, 131, 146]));

  it("Postseason Week 1 rechnet gegen Regular Week 18", () => {
    expect(groupWeekRows(h, 2026, 3, 1)?.map((r) => [r.id, r.week])).toEqual([
      ["MS", 4],
      ["LM", 3],
      ["DH", 5],
      ["CZ", 3],
      ["JA", 5],
    ]);
    expect(reportedWeekPoints(h, 2026, 3, 1, "JA")).toBe(5);
    expect(reportedWeekPoints(h, 2026, 2, 18, "CZ")).toBe(8);
  });

  it("fehlt die direkte Vorwoche, gibt es keine Wochenpunkte statt Punkte mehrerer Wochen", () => {
    const gap = hist(entry(2, 17, [150, 148, 140, 120, 130]), entry(3, 1, [164, 160, 155, 131, 146]));
    expect(groupWeekRows(gap, 2026, 3, 1)?.[0]?.week).toBeNull();
    expect(baseEntry(gap, 2026, 3, 1)).toBeNull();
  });

  it("Super Bowl rechnet gegen die Conference Woche, eine gemeldete Pro Bowl Woche zählt auch", () => {
    const sb = hist(entry(3, 3, [170, 165, 160, 135, 150]), entry(3, 5, [171, 165, 160, 136, 151]));
    expect(reportedWeekPoints(sb, 2026, 3, 5, "MS")).toBe(1);
    const withPb = hist(entry(3, 3, [170, 165, 160, 135, 150]), entry(3, 4, [170, 165, 160, 135, 150]), entry(3, 5, [171, 165, 160, 136, 151]));
    expect(reportedWeekPoints(withPb, 2026, 3, 5, "JA")).toBe(1);
  });

  it("Regular Week 1 zählt ab 0, auch wenn die Vorsaison im Verlauf steht", () => {
    const h2 = hist(entry(3, 5, [171, 165, 160, 136, 151]), entry(2, 1, [10, 9, 8, 7, 11], 2027));
    expect(reportedWeekPoints(h2, 2027, 2, 1, "JA")).toBe(11);
    expect(baseEntry(h2, 2027, 2, 1)).toBe("start");
  });
});

describe("Saison der Rangliste", () => {
  const standings = StandingsFileSchema.parse(JSON.parse(read("./fixtures/standings.json")));

  it("alte Datei Version 1 ohne season parst und gilt für jede Saison", () => {
    expect(standings.schemaVersion).toBe(1);
    expect(standings.season).toBeUndefined();
    expect(standingsAppliesTo(standings, 2027)).toBe(true);
  });

  it("neue Meldung schreibt Version 2 mit season, andere Saison gilt nicht", () => {
    const history = StandingsHistorySchema.parse(JSON.parse(read("./fixtures/standings-history.json")));
    const r = applyReport({ season: 2026, seasonType: 2, week: 9, players: players([79, 76, 75, 57, 54]) }, standings, history, NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.standings).toMatchObject({ schemaVersion: 2, season: 2026, asOfWeek: 9 });
    expect(standingsAppliesTo(r.standings, 2026)).toBe(true);
    expect(standingsAppliesTo(r.standings, 2027)).toBe(false);
    expect(StandingsFileSchema.parse(JSON.parse(JSON.stringify(r.standings))).season).toBe(2026);
  });
});

const reviewOf = (over: Partial<ReviewFile>): ReviewFile =>
  ReviewFileSchema.parse({
    schemaVersion: 2,
    season: 2026,
    seasonType: 3,
    week: 1,
    updatedAt: NOW,
    complete: true,
    games: [],
    points: 4,
    tipped: 6,
    deviationNet: 0,
    tiebreakers: [],
    ...over,
  });

describe("rankingCheck", () => {
  const h = hist(entry(2, 18, [160, 157, 150, 128, 141]), entry(3, 1, [164, 160, 155, 131, 146]));

  it("Differenz gemeldet minus App Punkte für ein beliebiges Kürzel", () => {
    expect(rankingCheck(reviewOf({}), h, "JA")).toEqual({ playerId: "JA", reported: 5, appPoints: 4, gap: 1 });
    expect(rankingCheck(reviewOf({}), h, "LM")).toEqual({ playerId: "LM", reported: 3, appPoints: 4, gap: -1 });
  });

  it("null bei offener Bilanz, fehlender Vorwoche oder unbekanntem Kürzel", () => {
    expect(rankingCheck(reviewOf({ complete: false }), h, "JA")).toBeNull();
    expect(rankingCheck(reviewOf({ week: 2 }), h, "JA")).toBeNull();
    expect(rankingCheck(reviewOf({}), hist(entry(3, 1, [1, 1, 1, 1, 1])), "JA")).toBeNull();
    expect(rankingCheck(reviewOf({}), h, "XY")).toBeNull();
  });

  it("withRankingCheck setzt und entfernt das Feld", () => {
    const r = withRankingCheck(reviewOf({}), { playerId: "JA", reported: 5, appPoints: 4, gap: 1 });
    expect(r.rankingCheck?.gap).toBe(1);
    expect(withRankingCheck(r, null)).not.toHaveProperty("rankingCheck");
  });

  it("alte Bilanz Version 1 ohne rankingCheck parst weiter", () => {
    const old = ReviewFileSchema.parse({ ...reviewOf({}), schemaVersion: 1 });
    expect(old.schemaVersion).toBe(1);
    expect(old.rankingCheck).toBeUndefined();
  });
});

describe("build-review mit Rangliste", () => {
  const w8Text = read("./fixtures/espn-scoreboard-2026-w8.json");
  const finalW8 = () => {
    const d = JSON.parse(w8Text);
    for (const e of d.events) {
      e.status.type = { ...e.status.type, name: "STATUS_FINAL", state: "post", completed: true };
      if (e.id === "401873036") for (const c of e.competitions[0].competitors) c.score = c.homeAway === "home" ? "27" : "20";
    }
    return JSON.stringify(d);
  };
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nfl-rank-"));
    await mkdir(join(dir, "tips"));
    await writeFile(join(dir, "tips/2026-2-08.json"), read("./fixtures/tips-2026-2-08.json"));
    await writeFile(join(dir, "standings.json"), read("./fixtures/standings.json"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  let urls: string[] = [];
  const deps = (now: string) => ({
    fetch: (async (url: string) => {
      urls.push(url);
      return new Response(finalW8());
    }) as FetchFn,
    dataDir: dir,
    now: () => now,
    log: () => {},
    error: () => {},
  });
  const review = async () => ReviewFileSchema.parse(JSON.parse(await readFile(join(dir, "reviews/2026-2-08.json"), "utf8")));

  it("ohne Vorwoche kein Abgleich, spätere Meldung ergänzt ihn ohne neuen Abruf", async () => {
    await writeFile(join(dir, "standings-history.json"), JSON.stringify(hist(entry(2, 8, [71, 69, 68, 51, 45]))));
    expect(await reviewMain([], deps("2026-11-04T10:00:00Z"))).toBe(0);
    const first = await review();
    expect(first).toMatchObject({ schemaVersion: 2, complete: true, points: 1 });
    expect(first.rankingCheck).toBeUndefined();

    await writeFile(
      join(dir, "standings-history.json"),
      JSON.stringify(hist(entry(2, 7, [64, 62, 61, 46, 43]), entry(2, 8, [71, 69, 68, 51, 45]))),
    );
    urls = [];
    expect(await reviewMain([], deps("2026-11-05T10:00:00Z"))).toBe(0);
    expect(urls).toEqual([]);
    const second = await review();
    expect(second.rankingCheck).toEqual({ playerId: "JA", reported: 2, appPoints: 1, gap: 1 });
    expect(second.updatedAt).toBe("2026-11-05T10:00:00Z");

    const text = await readFile(join(dir, "reviews/2026-2-08.json"), "utf8");
    expect(await reviewMain([], deps("2026-11-06T10:00:00Z"))).toBe(0);
    expect(await readFile(join(dir, "reviews/2026-2-08.json"), "utf8")).toBe(text);
  });

  it("ungültige Rangliste blockiert die Bilanz nicht", async () => {
    await writeFile(join(dir, "standings-history.json"), "{kaputt");
    expect(await reviewMain([], deps("2026-11-04T10:00:00Z"))).toBe(0);
    expect((await review()).rankingCheck).toBeUndefined();
  });
});

const g = (id: string, kickoffUtc: string, homeId: string, awayId: string, status: Game["status"] = "final") => ({
  id,
  kickoffUtc,
  homeId,
  awayId,
  status,
});

describe("Ruhetage", () => {
  const prev = [
    g("a", "2026-11-01T18:00:00Z", "1", "2"), // So 1.11.
    g("b", "2026-11-03T01:15:00Z", "3", "4"), // Mo 2.11. abends New York
    g("c", "2026-10-25T17:00:00Z", "5", "6"), // So 25.10., Team 5 danach Bye
    g("d", "2026-11-01T18:00:00Z", "7", "8", "canceled"),
  ];

  it("Sonntag zu Sonntag 7, Montag zu Sonntag 6, Sonntag zu Donnerstag 4, nach Bye 14", () => {
    const sun = { id: "x", kickoffUtc: "2026-11-08T18:00:00Z" };
    expect(restDays("1", sun, prev)).toBe(7);
    expect(restDays("3", sun, prev)).toBe(6);
    expect(restDays("2", { id: "y", kickoffUtc: "2026-11-06T01:15:00Z" }, prev)).toBe(4);
    expect(restDays("5", sun, prev)).toBe(14);
  });

  it("abgesagte Spiele und unbekannte Teams ergeben null, spätere Spiele zählen nicht", () => {
    expect(restDays("7", { id: "x", kickoffUtc: "2026-11-08T18:00:00Z" }, prev)).toBeNull();
    expect(restDays("99", { id: "x", kickoffUtc: "2026-11-08T18:00:00Z" }, prev)).toBeNull();
    expect(restDays("1", { id: "x", kickoffUtc: "2026-10-30T18:00:00Z" }, prev)).toBeNull();
  });

  it("Tageszahl in New York über das Ende der Sommerzeit", () => {
    expect(newYorkDayNumber("2026-11-02T04:30:00Z") - newYorkDayNumber("2026-11-01T03:30:00Z")).toBe(1);
    expect(newYorkDayNumber("2026-11-02T04:59:00Z")).toBe(newYorkDayNumber("2026-11-01T23:00:00Z"));
  });

  it("withRestDays ohne Vorwoche lässt Spiele unverändert", () => {
    const games = [g("x", "2026-11-08T18:00:00Z", "1", "3")];
    expect(withRestDays(games, null)).toEqual(games);
    expect(withRestDays(games, prev)[0]).toMatchObject({ homeRest: 7, awayRest: 6 });
  });
});

describe("Spielort und Rückwärtskompatibilität der Wochendatei", () => {
  it("venueInfo aus ESPN, alte Wochendatei Version 1 ohne neue Felder parst", () => {
    const parsed = parseScoreboard(JSON.parse(read("./fixtures/espn-scoreboard-2026-w8.json")), { fetchedAt: NOW });
    if (!parsed.ok) throw new Error(parsed.error);
    const game = parsed.week.games.find((x) => x.id === "401873036")!;
    expect(game).toMatchObject({ venue: "Lumen Field", neutralSite: false, venueInfo: { name: "Lumen Field", city: "Seattle", country: "USA" } });
    const { venueInfo: _v, ...oldGame } = game;
    const old = WeekFileSchema.parse({ ...parsed.week, schemaVersion: 1, games: [oldGame] });
    expect(old.games[0]).not.toHaveProperty("venueInfo");
    expect(WeekFileSchema.safeParse({ ...parsed.week, schemaVersion: 3 }).success).toBe(false);
  });

  it("ohne venue von ESPN fehlt venueInfo", () => {
    const raw = JSON.parse(read("./fixtures/espn-scoreboard-2026-w8.json"));
    delete raw.events[0].competitions[0].venue;
    const parsed = parseScoreboard(raw, { fetchedAt: NOW });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.week.games.find((x) => x.id === raw.events[0].id)).not.toHaveProperty("venueInfo");
  });
});
