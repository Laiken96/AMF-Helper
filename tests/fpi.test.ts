import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameStatus } from "../src/core/schema";
import { FpiFileSchema, buildFpiFile, fpiFilePath, fpiFromSummary, sameFpiContent } from "../src/core/fpi";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const summary = read("./fixtures/espn-summary-2026-w9-401873037.json");
const live = read("./fixtures/espn-summary-2026-w9-401873037-live-synthetic.json");

// JAX@BAL, Thursday Night Week 9
const tnf = { id: "401873037", kickoffUtc: "2026-11-06T01:15:00Z", homeId: "33", awayId: "30", status: "scheduled" as GameStatus };
const T0 = "2026-11-03T12:00:00Z";
const T1 = "2026-11-04T12:00:00Z";
const AFTER = "2026-11-06T02:00:00Z";

const build = (
  fetched: Map<string, { pHome: number; pAway: number }>,
  existing: ReturnType<typeof buildFpiFile> | null,
  now: string,
  status: GameStatus = "scheduled",
) => buildFpiFile({ season: 2026, seasonType: 2, week: 9, games: [{ ...tnf, status }], fetched, existing, now });

describe("FPI aus dem Summary", () => {
  it("liest gameProjection als Wahrscheinlichkeit", () => {
    expect(fpiFromSummary(summary, tnf)).toEqual({ pHome: 0.478, pAway: 0.518 });
  });

  it("fehlender predictor oder falsche Teams ergeben null", () => {
    expect(fpiFromSummary(live, tnf)).toBeNull();
    expect(fpiFromSummary(summary, { homeId: "30", awayId: "33" })).toBeNull();
    expect(fpiFromSummary({ predictor: { homeTeam: { id: "33", gameProjection: "abc" }, awayTeam: { id: "30", gameProjection: "1" } } }, tnf)).toBeNull();
    expect(fpiFromSummary(null, tnf)).toBeNull();
  });

  it("Zahl statt Text wird akzeptiert", () => {
    expect(fpiFromSummary({ predictor: { homeTeam: { id: "33", gameProjection: 60 }, awayTeam: { id: "30", gameProjection: 40 } } }, tnf)).toEqual({ pHome: 0.6, pAway: 0.4 });
  });
});

describe("FPI Datei", () => {
  it("Pfad und Schema", () => {
    expect(fpiFilePath(2026, 2, 9)).toBe("fpi/2026-2-09.json");
    const f = build(new Map([[tnf.id, { pHome: 0.478, pAway: 0.518 }]]), null, T0);
    expect(FpiFileSchema.parse(f).games).toEqual([
      { gameId: tnf.id, kickoffUtc: tnf.kickoffUtc, homeId: "33", awayId: "30", pHome: 0.478, pAway: 0.518, fetchedAt: T0, locked: false },
    ]);
  });

  it("gleiche Werte behalten den Zeitstempel, neue Werte ersetzen", () => {
    const a = build(new Map([[tnf.id, { pHome: 0.478, pAway: 0.518 }]]), null, T0);
    const b = build(new Map([[tnf.id, { pHome: 0.478, pAway: 0.518 }]]), a, T1);
    expect(sameFpiContent(a, b)).toBe(true);
    const c = build(new Map([[tnf.id, { pHome: 0.2, pAway: 0.79 }]]), b, T1);
    expect(c.games[0]).toMatchObject({ pHome: 0.2, fetchedAt: T1 });
  });

  it("fehlender Abruf behält den alten Stand", () => {
    const a = build(new Map([[tnf.id, { pHome: 0.478, pAway: 0.518 }]]), null, T0);
    expect(build(new Map(), a, T1).games).toEqual(a.games);
  });

  it("ab Kickoff eingefroren, spätere Werte ändern nichts", () => {
    const a = build(new Map([[tnf.id, { pHome: 0.478, pAway: 0.518 }]]), null, T0);
    const b = build(new Map([[tnf.id, { pHome: 0.9, pAway: 0.1 }]]), a, AFTER);
    expect(b.games[0]).toMatchObject({ pHome: 0.478, fetchedAt: T0, locked: true });
    const c = build(new Map([[tnf.id, { pHome: 0.9, pAway: 0.1 }]]), b, AFTER, "scheduled");
    expect(c.games[0]).toMatchObject({ pHome: 0.478, locked: true });
  });

  it("Spiel nicht mehr geplant sperrt auch vor dem Kickoff", () => {
    const a = build(new Map([[tnf.id, { pHome: 0.478, pAway: 0.518 }]]), null, T0);
    expect(build(new Map([[tnf.id, { pHome: 0.9, pAway: 0.1 }]]), a, T1, "in_progress").games[0]).toMatchObject({ pHome: 0.478, locked: true });
  });
});
