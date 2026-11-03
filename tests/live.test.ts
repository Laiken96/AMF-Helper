import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Game } from "../src/core/schema";
import {
  LIVE_INTERVAL_MS,
  LIVE_MAX_BACKOFF_MS,
  liveDelay,
  maybeLive,
  parseLastPlays,
  parseLiveScoreboard,
  periodText,
  type LiveGame,
} from "../src/app/live";

// Nachgebaute ESPN Antworten (synthetic), Struktur aus der echten Scoreboard Fixture Week 9
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const board = () => read("espn-scoreboard-2026-w9-live-synthetic.json");
const summary = () => read("espn-summary-2026-w9-401873037-live-synthetic.json");

const KICKOFF = "2026-11-06T01:15:00Z";
const T0 = Date.parse(KICKOFF);
const HOUR = 60 * 60 * 1000;

const game = (over: Partial<Game> = {}): Game => ({
  id: "401873037",
  season: 2026,
  seasonType: 2,
  week: 9,
  kickoffUtc: KICKOFF,
  homeId: "33",
  awayId: "30",
  status: "scheduled",
  statusDetail: "",
  homeScore: null,
  awayScore: null,
  venue: null,
  neutralSite: false,
  ...over,
});

const live = (over: Partial<LiveGame> = {}): LiveGame => ({
  id: "401873037",
  state: "in",
  status: "in_progress",
  period: 3,
  clock: "4:12",
  detail: "4:12 - 3rd",
  homeScore: 17,
  awayScore: 10,
  possessionTeamId: null,
  downDistance: null,
  redZone: false,
  lastPlay: null,
  ...over,
});

describe("parseLiveScoreboard", () => {
  const map = parseLiveScoreboard(board());

  it("liest gültige Events und überspringt kaputte", () => {
    expect([...map.keys()].sort()).toEqual(["401873037", "401873038", "401873040", "401873042", "401873045"]);
    expect(map.has("999")).toBe(false);
  });

  it("laufendes Spiel mit Stand, Uhr und Situation", () => {
    expect(map.get("401873037")).toMatchObject({
      id: "401873037",
      state: "in",
      status: "in_progress",
      period: 3,
      clock: "4:12",
      detail: "4:12 - 3rd",
      homeScore: 17,
      awayScore: 10,
      possessionTeamId: "33",
      downDistance: "1st & 10 at JAX 18",
      redZone: true,
      lastPlay: "(4:12 - 3rd) L.Jackson pass short right to Z.Flowers for 12 yards",
    });
  });

  it("finales Spiel", () => {
    expect(map.get("401873040")).toMatchObject({ state: "post", status: "final", homeScore: 27, awayScore: 30, detail: "Final" });
  });

  it("verschobenes Spiel ist weder laufend noch final", () => {
    const g = map.get("401873045")!;
    expect(g.status).toBe("postponed");
    expect(g.state).toBe("pre");
  });

  it("abgesagtes Spiel ebenso", () => {
    const raw = board() as { events: { status: { type: Record<string, unknown> }; competitions: { status: { type: Record<string, unknown> } }[] }[] };
    const ev = raw.events.find((e) => (e as unknown as { id: string }).id === "401873042")!;
    for (const s of [ev.status, ev.competitions[0]!.status]) Object.assign(s.type, { name: "STATUS_CANCELED", state: "post", completed: false });
    expect(parseLiveScoreboard(raw).get("401873042")).toMatchObject({ state: "pre", status: "canceled" });
  });

  it("geplantes Spiel ohne Situation", () => {
    expect(map.get("401873042")).toMatchObject({ state: "pre", status: "scheduled", possessionTeamId: null, redZone: false, lastPlay: null });
  });

  it("Status ohne name gilt nach state", () => {
    const raw = { events: [{ id: "1", competitions: [{ status: { period: 2, displayClock: "1:00", type: { state: "in" } }, competitors: [] }] }] };
    expect(parseLiveScoreboard(raw).get("1")).toMatchObject({ state: "in", status: "in_progress", homeScore: null });
  });

  it("wirft bei falschem Format der Antwort", () => {
    expect(() => parseLiveScoreboard({ foo: 1 })).toThrow();
    expect(() => parseLiveScoreboard(null)).toThrow();
  });
});

describe("periodText", () => {
  const map = parseLiveScoreboard(board());

  it("Viertel und Uhr", () => {
    expect(periodText(map.get("401873037")!)).toBe("Q3 4:12");
  });

  it("Verlängerung als OT", () => {
    expect(periodText(map.get("401873038")!)).toBe("OT 7:11");
    expect(periodText(live({ period: 6, clock: "2:00" }))).toBe("OT2 2:00");
  });

  it("abgelaufene Uhr nutzt den Detailtext, etwa Halbzeit", () => {
    expect(periodText(live({ period: 2, clock: "0:00", detail: "Halftime" }))).toBe("Halftime");
    expect(periodText(live({ period: 4, clock: "0:00", detail: null }))).toBe("Q4");
  });

  it("nicht laufend: Detailtext", () => {
    expect(periodText(map.get("401873040")!)).toBe("Final");
    expect(periodText(live({ state: "pre", status: "scheduled", detail: null }))).toBe("");
  });
});

describe("maybeLive", () => {
  it("ohne Live Daten: Fenster von 6 Stunden ab Kickoff", () => {
    const g = game();
    expect(maybeLive(g, undefined, T0 - 1)).toBe(false);
    expect(maybeLive(g, undefined, T0)).toBe(true);
    expect(maybeLive(g, undefined, T0 + 6 * HOUR - 1)).toBe(true);
    expect(maybeLive(g, undefined, T0 + 6 * HOUR)).toBe(false);
  });

  it("Wochendatei in_progress gilt auch ausserhalb des Fensters, final nie", () => {
    expect(maybeLive(game({ status: "in_progress" }), undefined, T0 - HOUR)).toBe(true);
    expect(maybeLive(game({ status: "final" }), undefined, T0 + HOUR)).toBe(false);
  });

  it("Live Daten haben Vorrang", () => {
    expect(maybeLive(game({ status: "final" }), live(), T0 + 5 * HOUR)).toBe(true);
    // Auch live gemeldete Spiele enden nach dem 6 Stunden Fenster (ESPN dauerhaft weg)
    expect(maybeLive(game({ status: "final" }), live(), T0 + 8 * HOUR)).toBe(false);
    expect(maybeLive(game({ status: "in_progress" }), live({ state: "post", status: "final" }), T0 + HOUR)).toBe(false);
    expect(maybeLive(game(), live({ state: "pre", status: "scheduled" }), T0 + HOUR)).toBe(true);
  });

  it("verschobene und abgesagte Spiele pollen nie", () => {
    for (const status of ["postponed", "canceled"] as const) {
      expect(maybeLive(game({ status }), undefined, T0 + HOUR)).toBe(false);
      expect(maybeLive(game({ status }), live(), T0 + HOUR)).toBe(false);
      expect(maybeLive(game(), live({ state: "pre", status }), T0 + HOUR)).toBe(false);
    }
  });

  it("verschoben laut Scoreboard Fixture", () => {
    const map = parseLiveScoreboard(board());
    expect(maybeLive(game({ id: "401873045" }), map.get("401873045"), T0 + HOUR)).toBe(false);
  });
});

describe("parseLastPlays", () => {
  it("neueste zuerst, ohne Doppel und leere Texte, Team aus Spielzug oder Drive", () => {
    const plays = parseLastPlays(summary());
    expect(plays.map((p) => p.id)).toEqual([
      "401873037902",
      "401873037901",
      "401873037203",
      "401873037201",
      "401873037103",
      "401873037102",
      "401873037101",
    ]);
    expect(plays[0]).toEqual({
      id: "401873037902",
      text: "L.Jackson pass short right to Z.Flowers for 12 yards",
      period: 3,
      clock: "4:12",
      teamId: "33",
      scoring: false,
    });
    expect(plays.find((p) => p.id === "401873037103")).toMatchObject({ scoring: true, teamId: "33", period: 1, clock: "10:59" });
    expect(plays.find((p) => p.id === "401873037203")?.teamId).toBe("30");
  });

  it("begrenzt auf limit", () => {
    expect(parseLastPlays(summary(), 2).map((p) => p.id)).toEqual(["401873037902", "401873037901"]);
  });

  it("Summary ohne drives (vor Kickoff) liefert eine leere Liste", () => {
    expect(parseLastPlays(read("espn-summary-2026-w9-401873037.json"))).toEqual([]);
  });

  it("wirft bei falschem Format", () => {
    expect(() => parseLastPlays("kein Objekt")).toThrow();
  });
});

describe("liveDelay", () => {
  it("20 s im Normalfall und nach dem ersten Fehler, dann verdoppelt bis 5 Minuten", () => {
    expect(liveDelay(0)).toBe(LIVE_INTERVAL_MS);
    expect([1, 2, 3, 4, 5, 6, 20].map(liveDelay)).toEqual([20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
    expect(LIVE_MAX_BACKOFF_MS).toBe(300_000);
  });
});
