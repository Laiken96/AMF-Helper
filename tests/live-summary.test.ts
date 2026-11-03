import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLiveScoreboard } from "../src/app/live";
import {
  clockSeconds,
  elapsedSeconds,
  fahrenheitToCelsius,
  fieldPosition,
  parseLiveSummary,
  tipStanding,
  winSeries,
} from "../src/app/live-summary";

// Echte ESPN Antworten MNF CHI@SEA vom 2026-11-03, 1. Viertel 4:20 (R105)
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const summary = () => read("espn-summary-2026-w8-401873036-live-q1.json");
const board = () => read("espn-scoreboard-2026-w8-live-q1.json");

const SEA = { id: "26", abbr: "SEA" };
const CHI = { id: "3", abbr: "CHI" };

describe("parseLiveSummary mit echter Antwort", () => {
  const s = parseLiveSummary(summary());

  it("Teams mit Bilanz und Punkten je Viertel", () => {
    expect(s.teams).toEqual([
      { id: "26", side: "home", abbr: "SEA", record: "4-3", lines: [0] },
      { id: "3", side: "away", abbr: "CHI", record: "5-2", lines: [7] },
    ]);
  });

  it("Siegchance pro Spielzug mit Spielzeit", () => {
    expect(s.winProb).toHaveLength(28);
    expect(s.winProb[0]).toEqual({ playId: "4018730361", home: 0.568, t: null });
    expect(s.winProb.at(-1)).toEqual({ playId: "401873036660", home: 0.3724, t: 15 * 60 - (4 * 60 + 23) });
  });

  it("aktueller Drive", () => {
    expect(s.drive).toEqual({ teamId: "26", plays: 3, yards: 11, time: "1:02", start: "SEA 20" });
  });

  it("letzte 10 Spielzüge, neueste zuerst, ohne Doppel des laufenden Drives", () => {
    expect(s.plays).toHaveLength(10);
    expect(s.plays[0]).toMatchObject({ id: "401873036660", period: 1, clock: "4:23", teamId: "26", scoring: false, type: "Pass Incompletion" });
    expect(new Set(s.plays.map((p) => p.id)).size).toBe(10);
  });

  it("Punktspielzüge", () => {
    expect(s.scoring).toEqual([
      {
        id: "401873036542",
        text: "Luther Burden III 1 Yd pass from Caleb Williams (Cairo Santos Kick)",
        type: "TD",
        period: 1,
        clock: "5:25",
        teamId: "3",
        awayScore: 7,
        homeScore: 0,
      },
    ]);
  });

  it("Teamvergleich auf Deutsch mit Werten für die Balken", () => {
    expect(s.stats.map((r) => r.label)).toEqual([
      "Yards gesamt",
      "Pass Yards",
      "Lauf Yards",
      "First Downs",
      "Third Down",
      "Ballverluste",
      "Strafen",
      "Ballbesitz",
    ]);
    const byKey = new Map(s.stats.map((r) => [r.key, r]));
    expect(byKey.get("totalYards")).toMatchObject({ away: { display: "80", value: 80 }, home: { display: "1", value: 1 } });
    // Negative Pass Yards bleiben als Text, der Balken beginnt bei 0
    expect(byKey.get("netPassingYards")!.home).toEqual({ display: "-6", value: 0 });
    expect(byKey.get("thirdDownEff")).toMatchObject({ away: { display: "3 von 4", value: 0.75 }, home: { display: "0 von 1", value: 0 } });
    expect(byKey.get("totalPenaltiesYards")!.away).toEqual({ display: "1 (15 Yds)", value: 1 });
    expect(byKey.get("possessionTime")).toMatchObject({ away: { display: "8:32", value: 512 }, home: { display: "2:05", value: 125 } });
  });

  it("Top Spieler Pass, Lauf, Fang", () => {
    expect(s.leaders.filter((l) => l.teamId === "26").map((l) => l.category)).toEqual(["pass", "rush"]);
    expect(s.leaders.find((l) => l.teamId === "26" && l.category === "pass")).toEqual({
      category: "pass",
      teamId: "26",
      name: "S. Darnold",
      display: "0/3, 0 YDS",
    });
    expect(s.leaders.filter((l) => l.teamId === "3").map((l) => l.category)).toEqual(["pass", "rush", "rec"]);
  });

  it("Ort, Wetter in Celsius, TV", () => {
    expect(s.info).toEqual({
      venue: "Lumen Field",
      city: "Seattle, WA",
      indoor: null,
      tempC: 9,
      weather: "Meist bewölkt",
      tv: ["ESPN"],
    });
  });
});

describe("parseLiveSummary mit fehlenden Feldern", () => {
  it("leeres Objekt ergibt leere Blöcke ohne Fehler", () => {
    expect(parseLiveSummary({})).toEqual({
      teams: [],
      winProb: [],
      drive: null,
      plays: [],
      scoring: [],
      stats: [],
      leaders: [],
      info: { venue: null, city: null, indoor: null, tempC: null, weather: null, tv: [] },
    });
  });

  it("kaputte Einträge werden übersprungen", () => {
    const s = parseLiveSummary({
      header: { competitions: [{ competitors: [null, { id: 5 }, { id: "1", homeAway: "home", linescores: "x" }] }] },
      winprobability: [{ homeWinPercentage: 2 }, { homeWinPercentage: "0.4", playId: "a" }, "x"],
      drives: { previous: "x", current: { plays: [null, { text: 3 }] } },
      scoringPlays: [{}],
      boxscore: { teams: [{ homeAway: "away", statistics: [{ name: "totalYards", displayValue: "10" }] }] },
      leaders: [{ team: {}, leaders: [] }],
      gameInfo: { weather: { temperature: "x" } },
    });
    expect(s.teams).toEqual([{ id: "1", side: "home", abbr: null, record: null, lines: [] }]);
    expect(s.winProb).toEqual([{ playId: "a", home: 0.4, t: null }]);
    expect(s.drive).toEqual({ teamId: null, plays: null, yards: null, time: null, start: null });
    expect(s.plays).toEqual([]);
    expect(s.scoring).toEqual([]);
    expect(s.stats).toEqual([]);
    expect(s.info.tempC).toBeNull();
  });

  it("kein Objekt wirft", () => {
    expect(() => parseLiveSummary(null)).toThrow();
    expect(() => parseLiveSummary([])).toThrow();
  });
});

describe("Scoreboard Zusatz für den Ticker", () => {
  it("Bilanz, Viertel, Feldposition und TV aus der echten Antwort", () => {
    const g = parseLiveScoreboard(board()).get("401873036")!;
    expect(g).toMatchObject({ state: "in", period: 1, clock: "4:20", awayScore: 7, homeScore: 0, possessionTeamId: "26", downDistance: "3rd & 8 at SEA 31" });
    expect(g.extra).toEqual({
      awayRecord: "5-2",
      homeRecord: "4-3",
      awayLines: [7],
      homeLines: [0],
      fieldText: "SEA 31",
      yardLine: 31,
      distance: 8,
      broadcast: "ESPN",
    });
  });
});

describe("Hilfen", () => {
  it("Uhr und Spielzeit", () => {
    expect(clockSeconds("4:23")).toBe(263);
    expect(clockSeconds("x")).toBeNull();
    expect(elapsedSeconds(1, "15:00")).toBe(0);
    expect(elapsedSeconds(4, "0:00")).toBe(3600);
    expect(elapsedSeconds(5, "5:00")).toBe(3900);
    expect(elapsedSeconds(null, "1:00")).toBeNull();
  });

  it("Fahrenheit in Celsius", () => {
    expect(fahrenheitToCelsius(48)).toBe(9);
    expect(fahrenheitToCelsius(32)).toBe(0);
  });

  it("Feldposition Heimteam in der eigenen Hälfte greift nach links an", () => {
    const p = fieldPosition({ fieldText: "SEA 31", yardLine: 31, possessionTeamId: "26", home: SEA, away: CHI })!;
    expect(p).toMatchObject({ x: 69, dir: "left", toGo: 69, redZone: false });
    expect(p.spoken).toBe("Ball bei SEA 31, SEA greift an, noch 69 Yards bis zur Endzone");
  });

  it("Gastteam in der Red Zone", () => {
    const p = fieldPosition({ fieldText: "SEA 16", yardLine: 16, possessionTeamId: "3", home: SEA, away: CHI })!;
    expect(p).toMatchObject({ x: 84, dir: "right", toGo: 16, redZone: true });
    expect(p.spoken).toContain("Red Zone");
  });

  it("ohne Text zählt yardLine, ohne beides keine Grafik", () => {
    expect(fieldPosition({ fieldText: null, yardLine: 80, possessionTeamId: "3", home: SEA, away: CHI })).toMatchObject({ x: 20, toGo: 80 });
    expect(fieldPosition({ fieldText: "50", yardLine: null, possessionTeamId: null, home: SEA, away: CHI })).toMatchObject({ x: 50, dir: null, toGo: null });
    expect(fieldPosition({ fieldText: "", yardLine: null, possessionTeamId: "3", home: SEA, away: CHI })).toBeNull();
  });

  it("Tipp vorne oder hinten nach Siegchance", () => {
    expect(tipStanding(0.3724, "26", "26")).toBe("hinten");
    expect(tipStanding(0.3724, "3", "26")).toBe("vorne");
    expect(tipStanding(0.5, "3", "26")).toBe("gleich");
  });

  it("Linie der Siegchance über die Spielzeit", () => {
    const s = parseLiveSummary(summary());
    const { span, points } = winSeries(s.winProb);
    expect(span).toBe(3600);
    expect(points[0]).toEqual({ x: 0, y: 0.568 });
    expect(points.at(-1)!.x).toBeCloseTo(637 / 3600);
    // Zeit nie rückwärts
    expect(points.every((p, i) => i === 0 || p.x >= points[i - 1]!.x)).toBe(true);
    expect(winSeries([])).toEqual({ span: 3600, points: [] });
  });
});
