import { describe, expect, it } from "vitest";
import type { Game, WeekFile } from "../src/core/schema";
import { buildTipsFile } from "../src/core/tips";
import type { Odds, StandingsFile, TipsFile } from "../src/core/tips-schema";
import {
  MAIN_FALLBACK,
  applyChoices,
  choiceKey,
  choiceLocked,
  mainPlayer,
  parseChoices,
  readChoices,
  shownTipsFor,
  storeChoice,
  usePlayer,
} from "../src/app/player";

const T0 = "2026-11-05T12:00:00Z";

function game(id: string, kickoffUtc: string, extra: Partial<Game> = {}): Game {
  return {
    id,
    season: 2026,
    seasonType: 2,
    week: 9,
    kickoffUtc,
    homeId: `h${id}`,
    awayId: `a${id}`,
    status: "scheduled",
    statusDetail: "",
    homeScore: null,
    awayScore: null,
    venue: null,
    neutralSite: false,
    ...extra,
  };
}

const odds = (spreadHome: number, overUnder: number | null = 45): Odds => ({
  provider: "DraftKings",
  spreadHome,
  overUnder,
  fetchedAt: T0,
});

function weekOf(games: Game[]): WeekFile {
  return { schemaVersion: 1, season: 2026, seasonType: 2, week: 9, fetchedAt: T0, source: "espn", games, byeTeamIds: [] };
}

// Stand nach Week 8: JA 26 hinter MS. Seit D052 ohne Einfluss auf die Tipps
function standings(me = "JA", season?: number): StandingsFile {
  return {
    schemaVersion: 1,
    asOfWeek: 8,
    updatedAt: T0,
    me,
    ...(season === undefined ? {} : { season }),
    players: [
      { id: "MS", points: 71 },
      { id: "LM", points: 69 },
      { id: "DH", points: 68 },
      { id: "CZ", points: 51 },
      { id: "JA", points: 45 },
    ],
  };
}

// Do Spiel als Tiebreaker, dazu drei unklare Spiele und ein klares am Sonntag, Montag als zweiter Tiebreaker
const GAMES = [
  game("1", "2026-11-06T01:15:00Z"), // Do in New York
  game("2", "2026-11-08T18:00:00Z"),
  game("3", "2026-11-08T18:00:00Z"),
  game("4", "2026-11-08T21:25:00Z"),
  game("5", "2026-11-10T01:15:00Z"), // Mo in New York
];
const ODDS: Record<string, Odds> = {
  "1": odds(-1.5, 44), // unklar, Heim knapp
  "2": odds(-2.5, 47), // unklar
  "3": odds(1, 41), // unklar, Auswärts knapp
  "4": odds(-10, 48), // klar
  "5": odds(-3, 43), // unklar
};
const WEEK = weekOf(GAMES);

function build(me: string, now = T0, games = GAMES): TipsFile {
  return buildTipsFile({ week: weekOf(games), odds: ODDS, standings: standings(me), existing: null, now });
}

const strip = (f: TipsFile) => ({ ...f, updatedAt: "" });

describe("Hauptnutzer (D058)", () => {
  it("gilt immer standings.me, ohne Rangliste das Kürzel JA", () => {
    expect(mainPlayer(standings())).toBe("JA");
    expect(mainPlayer(standings("MS"))).toBe("MS");
    expect(mainPlayer(null)).toBe("JA");
    expect(mainPlayer(undefined)).toBe(MAIN_FALLBACK);
    expect(usePlayer(standings("DH"))).toBe("DH");
    expect(usePlayer(null)).toBe("JA");
  });

  it("Schlüssel der eigenen Wahl bleiben gleich, auch ohne Rangliste", () => {
    const ref = { season: 2026, seasonType: 2, week: 9 };
    expect(choiceKey(mainPlayer(null), ref)).toBe(choiceKey(mainPlayer(standings()), ref));
    expect(choiceKey(mainPlayer(null), ref)).toBe("nfl-dashboard:wahl:JA:2026-2-09");
  });
});

describe("Eigene Abweichung (D052)", () => {
  it("Schlüssel pro Spieler und Woche", () => {
    expect(choiceKey("JA", { season: 2026, seasonType: 2, week: 9 })).toBe("nfl-dashboard:wahl:JA:2026-2-09");
    expect(choiceKey(null, { season: 2026, seasonType: 3, week: 1 })).toBe("nfl-dashboard:wahl:ohne:2026-3-01");
  });

  it("liest nur gültige Einträge", () => {
    expect(parseChoices(null)).toEqual({});
    expect(parseChoices("kaputt")).toEqual({});
    expect(parseChoices("[1,2]")).toEqual({});
    expect(parseChoices('{"1":"a1","2":3,"3":""}')).toEqual({ "1": "a1" });
  });

  it("merkt sich die Wahl ohne Storage bis zum Neuladen", () => {
    const key = choiceKey("JA", { season: 2026, seasonType: 2, week: 9 });
    storeChoice(key, "2", "a2");
    expect(readChoices(key)).toEqual({ "2": "a2" });
    // Gleicher Inhalt liefert dasselbe Objekt, sonst rendert React endlos
    expect(readChoices(key)).toBe(readChoices(key));
    storeChoice(key, "2", null);
    expect(readChoices(key)).toEqual({});
  });

  it("Vorschlag ohne Wahl unverändert, die Datei hat für jeden Spieler dieselben Tipps", () => {
    const file = build("JA");
    expect(file.maxDeviations).toBe(0);
    expect(applyChoices(file, GAMES, {})).toBe(file);
    expect(strip(build("MS"))).toEqual(strip(file));
  });

  it("Aussenseiter tippen: Tipp, Wahrscheinlichkeit, Markierung und Tiebreaker folgen", () => {
    const file = build("JA");
    // Spiel 1 ist der Donnerstag Tiebreaker, Heim knapp favorisiert
    const fav = file.tips.find((t) => t.gameId === "1")!;
    expect(fav.pickTeamId).toBe("h1");
    const shown = applyChoices(file, GAMES, { "1": "a1" });
    const t = shown.tips.find((x) => x.gameId === "1")!;
    expect(t).toMatchObject({ pickTeamId: "a1", pickProb: Math.round((1 - fav.pickProb!) * 10_000) / 10_000, deviation: true, changedSinceFirst: false });
    // Grundtipp bleibt der Vorschlag der App
    expect(t.firstPickTeamId).toBe("h1");
    // Getippter Aussenseiter gewinnt mit 3 Punkten bei gleichem Total 44
    const tb = shown.tiebreakers.find((x) => x.slot === "thursday")!;
    expect(tb).toMatchObject({ gameId: "1", awayPoints: 24, homePoints: 21 });
    // Andere Spiele und der zweite Tiebreaker bleiben
    expect(shown.tips.filter((x) => x.gameId !== "1")).toEqual(file.tips.filter((x) => x.gameId !== "1"));
    expect(shown.tiebreakers.find((x) => x.slot === "monday")).toEqual(file.tiebreakers.find((x) => x.slot === "monday"));
  });

  it("ignoriert Wahl für fremde Teams, den Favoriten und Spiele ohne Quote", () => {
    const file = build("JA");
    expect(applyChoices(file, GAMES, { "1": "h1", "2": "x9", "99": "a99" })).toBe(file);
    const noOdds = { ...file, tips: file.tips.map((t) => (t.gameId === "2" ? { ...t, odds: null, pHome: null, pickTeamId: null, pickProb: null, level: "offen" as const } : t)) };
    expect(applyChoices(noOdds, GAMES, { "2": "a2" })).toBe(noOdds);
  });

  it("Wahl gilt in Tipps und Spielen gleich, auch in vergangenen Wochen", () => {
    const file = build("JA");
    const a = shownTipsFor(file, GAMES, { "2": "a2" });
    const b = shownTipsFor(file, GAMES, { "2": "a2" });
    expect(a).toEqual(b);
    expect(a!.tips.find((t) => t.gameId === "2")!.pickTeamId).toBe("a2");
    expect(a!.tips.find((t) => t.gameId === "2")!.deviation).toBe(true);
    expect(shownTipsFor(file, GAMES, {})).toBe(file);
    expect(shownTipsFor(file, null, { "2": "a2" })).toBe(file);
    expect(shownTipsFor(null, GAMES, { "2": "a2" })).toBe(null);
  });

  it("Wahl gesperrt ab Kickoff, bei gesperrtem Tipp und bei nicht erfasstem Spiel", () => {
    const file = build("JA");
    const t = file.tips.find((x) => x.gameId === "1")!;
    const g = GAMES[0]!;
    expect(choiceLocked(t, g, T0)).toBe(false);
    expect(choiceLocked(t, g, "2026-11-06T01:15:00Z")).toBe(true);
    expect(choiceLocked({ ...t, locked: true }, g, T0)).toBe(true);
    expect(choiceLocked({ ...t, level: "nicht_erfasst" }, g, T0)).toBe(true);
    expect(choiceLocked(t, { ...g, status: "postponed" }, T0)).toBe(true);
  });

  it("nach Kickoff bleibt eine vorher getroffene Wahl angezeigt", () => {
    const before = build("JA");
    const later = "2026-11-06T02:00:00Z";
    const file = buildTipsFile({ week: WEEK, odds: ODDS, standings: standings(), existing: before, now: later });
    expect(file.tips[0]!.locked).toBe(true);
    const shown = applyChoices(file, GAMES, { "1": "a1" });
    expect(shown.tips[0]).toMatchObject({ pickTeamId: "a1", deviation: true, locked: true });
  });
});
