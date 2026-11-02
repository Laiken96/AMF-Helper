import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baselineStartUtc,
  buildInjuriesFile,
  diffInjuries,
  injuriesFilePath,
  keyPlayersFromSummary,
  nyMidnightUtc,
  parseSummary,
  summaryUrl,
  type InjuryState,
  type KeyPlayer,
} from "../src/core/injuries";
import { parseScoreboard } from "../src/core/espn";

const summaryRaw = JSON.parse(readFileSync(new URL("./fixtures/espn-summary-2026-w9-401873037.json", import.meta.url), "utf8"));
const w9Raw = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w9.json", import.meta.url), "utf8"));
const w8Raw = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w8.json", import.meta.url), "utf8"));

function weekGames(raw: unknown) {
  const r = parseScoreboard(raw, { fetchedAt: "2026-11-02T00:00:00Z" });
  if (!r.ok) throw new Error(r.error);
  return r.week.games;
}

const player = (over: Partial<KeyPlayer>): KeyPlayer => ({
  athleteId: "1",
  name: "Lamar Jackson",
  pos: "QB",
  teamId: "33",
  teamAbbr: "BAL",
  roles: ["qb", "passing"],
  status: null,
  ...over,
});

const state = (players: KeyPlayer[], takenAt = "2026-11-05T05:00:00Z"): InjuryState => ({
  takenAt,
  games: [{ gameId: "401873037", kickoffUtc: "2026-11-06T01:15:00Z", players }],
});

describe("ESPN Summary", () => {
  it("baut die URL und den Dateipfad", () => {
    expect(summaryUrl("401873037")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873037",
    );
    expect(injuriesFilePath(2026, 2, 9)).toBe("injuries/2026-2-09.json");
  });

  it("liest das echte Week 9 Fixture mit Quarterbacks und Leadern", () => {
    const r = parseSummary(summaryRaw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const players = keyPlayersFromSummary(r.summary);
    const byName = new Map(players.map((p) => [p.name, p]));
    expect(byName.get("Lamar Jackson")).toMatchObject({ teamAbbr: "BAL", roles: ["qb", "passing"], status: "Out" });
    expect(byName.get("Tyler Huntley")).toMatchObject({ roles: ["qb"], status: "Questionable" });
    expect(byName.get("Joe Fagnano")).toMatchObject({ roles: ["qb"], status: "Out" });
    expect(byName.get("Derrick Henry")).toMatchObject({ roles: ["rushing"], status: null });
    expect(byName.get("Zay Flowers")).toMatchObject({ roles: ["receiving"] });
    expect(byName.get("Trevor Lawrence")).toMatchObject({ teamAbbr: "JAX", roles: ["qb", "passing"] });
    // Verteidiger aus Sacks oder Tackles zählen nicht, auch nicht mit Verletzung.
    expect(byName.has("Nate Wiggins")).toBe(false);
    expect(byName.has("Roquan Smith")).toBe(false);
  });

  it("akzeptiert ein Summary ohne injuries und leaders", () => {
    const r = parseSummary({ header: {} });
    expect(r.ok && keyPlayersFromSummary(r.summary)).toEqual([]);
  });

  it("lehnt ein Summary mit falschem Typ ab", () => {
    expect(parseSummary({ injuries: "x" }).ok).toBe(false);
  });
});

describe("Grundstand Zeitpunkt", () => {
  it("Mitternacht New York mit Sommer und Winterzeit", () => {
    expect(new Date(nyMidnightUtc(2026, 10, 29)).toISOString()).toBe("2026-10-29T04:00:00.000Z");
    expect(new Date(nyMidnightUtc(2026, 11, 5)).toISOString()).toBe("2026-11-05T05:00:00.000Z");
  });

  it("Donnerstag vor dem ersten Sonntag der Woche", () => {
    expect(baselineStartUtc(weekGames(w9Raw))).toBe("2026-11-05T05:00:00Z");
    expect(baselineStartUtc(weekGames(w8Raw))).toBe("2026-10-29T04:00:00Z");
  });

  it("Spiel am Mittwoch zieht den Grundstand vor", () => {
    const games = [{ kickoffUtc: "2026-12-24T01:00:00Z" }, { kickoffUtc: "2026-12-27T18:00:00Z" }];
    // 23.12. 20:00 New York ist ein Mittwoch, der Donnerstag davor wäre zu spät.
    expect(baselineStartUtc(games)).toBe("2026-12-23T05:00:00Z");
  });
});

describe("Änderungen seit Grundstand", () => {
  it("Statuswechsel Questionable zu Out", () => {
    const c = diffInjuries(state([player({ status: "Questionable" })]), state([player({ status: "Out" })]));
    expect(c).toEqual([
      expect.objectContaining({ kind: "wechsel", from: "Questionable", to: "Out", teamAbbr: "BAL", name: "Lamar Jackson" }),
    ]);
  });

  it("neuer Eintrag", () => {
    const c = diffInjuries(state([player({})]), state([player({ status: "Doubtful" })]));
    expect(c).toEqual([expect.objectContaining({ kind: "neu", from: null, to: "Doubtful" })]);
  });

  it("Eintrag verschwindet, auch wenn der Spieler nicht mehr Schlüsselspieler ist", () => {
    const backup = player({ athleteId: "2", name: "Tyler Huntley", roles: ["qb"], status: "Questionable" });
    const c = diffInjuries(state([player({}), backup]), state([player({})]));
    expect(c).toEqual([expect.objectContaining({ kind: "weg", athleteId: "2", from: "Questionable", to: null })]);
  });

  it("neuer Quarterback auf der Liste nach dem Grundstand", () => {
    const backup = player({ athleteId: "2", name: "Tyler Huntley", roles: ["qb"], status: "Out" });
    const c = diffInjuries(state([player({})]), state([player({}), backup]));
    expect(c).toEqual([expect.objectContaining({ kind: "neu", athleteId: "2", to: "Out" })]);
  });

  it("ohne Grundstand keine Änderungen", () => {
    expect(diffInjuries(null, state([player({ status: "Out" })]))).toEqual([]);
  });

  it("unveränderter Status ist keine Änderung", () => {
    expect(diffInjuries(state([player({ status: "Out" })]), state([player({ status: "Out" })]))).toEqual([]);
  });
});

describe("Ausfall Datei", () => {
  const games = [{ id: "401873037", kickoffUtc: "2026-11-06T01:15:00Z" }];
  const base = { season: 2026, seasonType: 2, week: 9, games, complete: true };

  it("vor Donnerstag 00:00 New York kein Grundstand", () => {
    const f = buildInjuriesFile({
      ...base,
      fetched: new Map([["401873037", [player({ status: "Out" })]]]),
      existing: null,
      now: "2026-11-05T04:59:59Z",
    });
    expect(f.baseline).toBeNull();
    expect(f.changes).toEqual([]);
    expect(f.baselineFrom).toBe("2026-11-05T05:00:00Z");
  });

  it("Grundstand wird genau einmal gesetzt und nie überschrieben", () => {
    const first = buildInjuriesFile({
      ...base,
      fetched: new Map([["401873037", [player({ status: "Questionable" })]]]),
      existing: null,
      now: "2026-11-05T05:00:00Z",
    });
    expect(first.baseline?.takenAt).toBe("2026-11-05T05:00:00Z");
    const second = buildInjuriesFile({
      ...base,
      fetched: new Map([["401873037", [player({ status: "Out" })]]]),
      existing: first,
      now: "2026-11-05T20:00:00Z",
    });
    expect(second.baseline).toEqual(first.baseline);
    expect(second.current.takenAt).toBe("2026-11-05T20:00:00Z");
    expect(second.changes).toEqual([expect.objectContaining({ kind: "wechsel", from: "Questionable", to: "Out" })]);
  });

  it("unvollständiger Lauf setzt keinen Grundstand und behält alte Spiele", () => {
    const prev = buildInjuriesFile({
      ...base,
      fetched: new Map([["401873037", [player({ status: "Out" })]]]),
      existing: null,
      now: "2026-11-04T12:00:00Z",
    });
    const f = buildInjuriesFile({ ...base, complete: false, fetched: new Map(), existing: prev, now: "2026-11-05T06:00:00Z" });
    expect(f.baseline).toBeNull();
    expect(f.current.games[0]?.players[0]?.status).toBe("Out");
  });
});
