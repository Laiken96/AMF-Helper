import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapStatus, parseScoreboard, scoreboardUrl } from "../src/core/espn";
import { TeamSchema, WeekFileSchema } from "../src/core/schema";

const fixtureText = readFileSync(new URL("./fixtures/espn-scoreboard-2026-w8.json", import.meta.url), "utf8");
const fixture = () => JSON.parse(fixtureText) as Record<string, any>;
const FETCHED = "2026-11-02T02:00:00Z";

describe("parseScoreboard mit echtem ESPN Fixture Woche 8", () => {
  const res = parseScoreboard(fixture(), { fetchedAt: FETCHED });
  if (!res.ok) throw new Error(res.error);
  const { week, teams } = res;

  it("liefert Saison und Woche aus der Quelle", () => {
    expect(week).toMatchObject({ schemaVersion: 1, season: 2026, seasonType: 2, week: 8, source: "espn" });
    expect(week.fetchedAt).toBe(FETCHED);
    expect(WeekFileSchema.safeParse(week).success).toBe(true);
  });

  it("hat 14 Spiele, sortiert nach Kickoff und ID", () => {
    expect(week.games).toHaveLength(14);
    const keys = week.games.map((g) => `${g.kickoffUtc}|${g.id.padStart(12, "0")}`);
    expect(keys).toEqual([...keys].sort());
    expect(week.games[0]!.kickoffUtc).toBe("2026-10-30T00:15:00Z");
  });

  it("hat 4 Bye Teams und 32 Teams nach Kürzel sortiert", () => {
    expect(week.byeTeamIds).toEqual(["18", "19", "25", "34"]);
    expect(teams).toHaveLength(32);
    const abbrs = teams.map((t) => t.abbr);
    expect(abbrs).toEqual([...abbrs].sort());
    for (const t of teams) expect(TeamSchema.safeParse(t).success).toBe(true);
    const saints = teams.find((t) => t.id === "18")!;
    expect(saints).toMatchObject({ abbr: "NO", name: "New Orleans Saints", shortName: "Saints", color: null });
    expect(saints.logo).toMatch(/^https:\/\//);
  });

  it("bildet das laufende Spiel mit Score ab", () => {
    const live = week.games.find((g) => g.id === "401873035")!;
    expect(live).toMatchObject({
      status: "in_progress",
      statusDetail: "13:43 - 2nd",
      homeScore: 3,
      awayScore: 10,
      venue: "Northwest Stadium",
      neutralSite: false,
    });
    const wsh = teams.find((t) => t.id === live.homeId)!;
    expect(wsh.abbr).toBe("WSH");
    expect(wsh.color).toBe("5a1414");
  });

  it("setzt Scores vor Kickoff auf null und beendete Spiele auf final", () => {
    const mnf = week.games.find((g) => g.id === "401873036")!;
    expect(mnf).toMatchObject({ status: "scheduled", homeScore: null, awayScore: null });
    expect(week.games.filter((g) => g.status === "final")).toHaveLength(12);
  });

  it("mappt postponed und canceled über den Status Namen", () => {
    const raw = fixture();
    raw.events[0].status.type = { ...raw.events[0].status.type, name: "STATUS_POSTPONED", state: "post" };
    raw.events[1].status.type = { ...raw.events[1].status.type, name: "STATUS_CANCELED", state: "post" };
    const r = parseScoreboard(raw);
    if (!r.ok) throw new Error(r.error);
    expect(r.week.games.find((g) => g.id === raw.events[0].id)!.status).toBe("postponed");
    expect(r.week.games.find((g) => g.id === raw.events[1].id)!.status).toBe("canceled");
  });

  it("setzt fehlendes oder ungültiges Logo und Farbe auf null", () => {
    const raw = fixture();
    const team = raw.events[0].competitions[0].competitors[0].team;
    team.logo = "";
    delete team.color;
    const r = parseScoreboard(raw);
    if (!r.ok) throw new Error(r.error);
    const t = r.teams.find((x) => x.id === team.id)!;
    expect(t.logo).toBeNull();
    expect(t.color).toBeNull();
  });
});

describe("parseScoreboard mit kaputten Daten", () => {
  it("lehnt Nicht Objekte ab", () => {
    for (const raw of [null, undefined, "kaputt", 42, []]) {
      const r = parseScoreboard(raw);
      expect(r.ok).toBe(false);
    }
  });

  it("lehnt abgeschnittenes JSON ab, nachdem es geparst werden müsste", () => {
    expect(() => JSON.parse(fixtureText.slice(0, 5000))).toThrow();
    expect(parseScoreboard({ events: "nope" }).ok).toBe(false);
  });

  it("meldet fehlende Pflichtfelder", () => {
    const noWeek = fixture();
    delete noWeek.week;
    const r1 = parseScoreboard(noWeek);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain("week");

    const noId = fixture();
    delete noId.events[3].id;
    expect(parseScoreboard(noId).ok).toBe(false);

    const noTeam = fixture();
    delete noTeam.events[0].competitions[0].competitors[1].team;
    expect(parseScoreboard(noTeam).ok).toBe(false);

    const badState = fixture();
    badState.events[0].status.type.state = "weird";
    expect(parseScoreboard(badState).ok).toBe(false);

    const badDate = fixture();
    badDate.events[0].date = "kein datum";
    expect(parseScoreboard(badDate).ok).toBe(false);
  });
});

describe("leere Woche", () => {
  it("events [] ist ok mit 0 Spielen", () => {
    const raw = fixture();
    raw.events = [];
    delete raw.week.teamsOnBye;
    const r = parseScoreboard(raw, { fetchedAt: FETCHED });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.week.games).toEqual([]);
    expect(r.week.byeTeamIds).toEqual([]);
    expect(r.teams).toEqual([]);
    expect(WeekFileSchema.safeParse(r.week).success).toBe(true);
  });
});

describe("scoreboardUrl", () => {
  it("ohne Parameter die aktuelle Woche", () => {
    expect(scoreboardUrl()).toBe("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
  });
  it("mit Saison, Typ und Woche", () => {
    expect(scoreboardUrl({ season: 2026, seasonType: 2, week: 8 })).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=8",
    );
  });
});

describe("mapStatus", () => {
  const st = (name: string, state: "pre" | "in" | "post", completed?: boolean) => ({
    type: { name, state, ...(completed === undefined ? {} : { completed }) },
  });

  it("final nur bei post mit completed oder STATUS_FINAL", () => {
    expect(mapStatus(st("STATUS_FINAL", "post", true))).toBe("final");
    expect(mapStatus(st("STATUS_FINAL", "post"))).toBe("final");
    expect(mapStatus(st("STATUS_FINAL_OVERTIME", "post", false))).toBe("final");
    expect(mapStatus(st("STATUS_END_OF_GAME", "post", true))).toBe("final");
  });

  it("suspendierte, abgebrochene, verwirkte und verzögerte Spiele mit post gelten als verschoben", () => {
    for (const name of ["STATUS_SUSPENDED", "STATUS_ABANDONED", "STATUS_FORFEIT", "STATUS_DELAYED", "STATUS_UNKNOWN"]) {
      expect(mapStatus(st(name, "post", false))).toBe("postponed");
      expect(mapStatus(st(name, "post"))).toBe("postponed");
    }
  });

  it("verschoben, abgesagt, geplant und laufend wie bisher", () => {
    expect(mapStatus(st("STATUS_POSTPONED", "post", false))).toBe("postponed");
    expect(mapStatus(st("STATUS_CANCELED", "post", false))).toBe("canceled");
    expect(mapStatus(st("STATUS_CANCELLED", "pre"))).toBe("canceled");
    expect(mapStatus(st("STATUS_SCHEDULED", "pre", false))).toBe("scheduled");
    expect(mapStatus(st("STATUS_IN_PROGRESS", "in", false))).toBe("in_progress");
  });

  it("echtes Fixture Woche 8: alle beendeten Spiele bleiben final", () => {
    const res = parseScoreboard(fixture(), { fetchedAt: FETCHED });
    if (!res.ok) throw new Error(res.error);
    expect(res.week.games.filter((g) => g.status === "final")).toHaveLength(12);
  });
});
