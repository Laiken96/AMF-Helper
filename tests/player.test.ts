import { describe, expect, it } from "vitest";
import type { Game, WeekFile } from "../src/core/schema";
import { buildTipsFile } from "../src/core/tips";
import type { Odds, StandingsFile, TipsFile } from "../src/core/tips-schema";
import {
  playerChoices,
  readStoredPlayer,
  resolvePlayer,
  standingsFor,
  storePlayer,
  tipsForPlayer,
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

// Stand nach Week 8: JA 26 hinter MS (2 Abweichungen), CZ 20 (1), DH 3 (0), MS in Führung (0)
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

describe("Spieler Auswahl", () => {
  it("nimmt ein bekanntes Kürzel, sonst den Hauptnutzer", () => {
    expect(resolvePlayer("MS", standings())).toBe("MS");
    expect(resolvePlayer("XY", standings())).toBe("JA");
    expect(resolvePlayer(null, standings())).toBe("JA");
    expect(resolvePlayer("MS", null)).toBe("MS");
  });

  it("listet die Kürzel der Rangliste sortiert, ohne Rangliste die des Formulars", () => {
    expect(playerChoices(standings())).toEqual(["CZ", "DH", "JA", "LM", "MS"]);
    expect(playerChoices(null)).toEqual(["CZ", "DH", "JA", "LM", "MS"]);
  });

  it("wechselt in der Rangliste nur me", () => {
    const s = standings();
    expect(standingsFor(s, "DH")).toEqual({ ...s, me: "DH" });
    expect(standingsFor(s, "JA")).toBe(s);
    expect(standingsFor(s, "XY")).toBe(s);
  });

  it("merkt sich die Wahl ohne Storage bis zum Neuladen", () => {
    // In Node fehlt window, jeder Storage Zugriff wirft und wird abgefangen
    storePlayer("DH");
    expect(readStoredPlayer()).toBe("DH");
    storePlayer(null);
    expect(readStoredPlayer()).toBe(null);
  });
});

describe("Tipps für einen anderen Spieler", () => {
  it("lässt die Datei für den Hauptnutzer unverändert", () => {
    const file = build("JA");
    expect(file.maxDeviations).toBe(2);
    expect(tipsForPlayer(file, GAMES, standings(), "JA", T0)).toBe(file);
    expect(tipsForPlayer(file, GAMES, standings(), "XY", T0)).toBe(file);
    expect(tipsForPlayer(file, GAMES, standings(), null, T0)).toBe(file);
  });

  it("ergibt dasselbe wie der Job für diesen Spieler", () => {
    const file = build("JA");
    for (const id of ["MS", "LM", "DH", "CZ"]) {
      expect(strip(tipsForPlayer(file, GAMES, standings(), id, T0))).toEqual(strip(build(id)));
    }
  });

  it("CZ mit 20 Punkten Rückstand bekommt eine Abweichung, MS in Führung keine", () => {
    const file = build("JA");
    const cz = tipsForPlayer(file, GAMES, standings(), "CZ", T0);
    expect(cz.maxDeviations).toBe(1);
    expect(cz.tips.filter((t) => t.deviation).map((t) => t.gameId)).toEqual(["3"]);
    const ms = tipsForPlayer(file, GAMES, standings(), "MS", T0);
    expect(ms.maxDeviations).toBe(0);
    expect(ms.tips.some((t) => t.deviation)).toBe(false);
    // Grundtipp bleibt der Favorit, ohne Abweichung keine Änderungsmarke
    for (const t of ms.tips) {
      expect(t.pickTeamId).toBe(t.firstPickTeamId);
      expect(t.changedSinceFirst).toBe(false);
    }
  });

  it("Tiebreaker folgt dem neu gewählten Tipp", () => {
    const file = build("JA");
    const jaTb = file.tiebreakers.find((tb) => tb.slot === "thursday")!;
    const devJa = file.tips.find((t) => t.gameId === "1")!.deviation;
    const ms = tipsForPlayer(file, GAMES, standings(), "MS", T0);
    const msTb = ms.tiebreakers.find((tb) => tb.slot === "thursday")!;
    // MS tippt den Heimfavoriten, das Heimteam gewinnt im Resultat
    expect(msTb.homePoints).toBeGreaterThan(msTb.awayPoints);
    if (devJa) expect(jaTb.awayPoints).toBeGreaterThan(jaTb.homePoints);
  });

  it("gesperrte Spiele bleiben, gesperrte Abweichungen zählen gegen das Budget", () => {
    // Spiel 3 läuft schon, im Job für JA als Abweichung gesperrt
    const before = build("JA", T0);
    expect(before.tips.find((t) => t.gameId === "3")!.deviation).toBe(true);
    const later = "2026-11-08T19:00:00Z";
    const games = GAMES.map((g) => (g.id === "1" || g.id === "2" || g.id === "3" ? { ...g, status: "in_progress" as const } : g));
    const file = buildTipsFile({ week: weekOf(games), odds: ODDS, standings: standings("JA"), existing: before, now: later });
    const cz = tipsForPlayer(file, games, standings(), "CZ", later);
    for (const id of ["1", "2", "3"]) expect(cz.tips.find((t) => t.gameId === id)).toEqual(file.tips.find((t) => t.gameId === id));
    // Budget 1 ist durch die gesperrte Abweichung aufgebraucht
    expect(cz.tips.filter((t) => !t.locked && t.deviation)).toEqual([]);
  });

  it("Spiel ab Kickoff gilt als gesperrt, auch wenn die Datei noch offen ist", () => {
    const file = build("JA");
    const kicked = "2026-11-06T02:00:00Z";
    const ms = tipsForPlayer(file, GAMES, standings(), "MS", kicked);
    expect(ms.tips[0]).toEqual(file.tips[0]);
    expect(ms.tiebreakers.find((tb) => tb.slot === "thursday")).toEqual(file.tiebreakers.find((tb) => tb.slot === "thursday"));
  });

  it("Rangliste aus einer anderen Saison ergibt keine Abweichung", () => {
    const file = build("JA");
    const old = standings("JA", 2025);
    expect(tipsForPlayer(file, GAMES, old, "CZ", T0).maxDeviations).toBe(0);
  });

  it("ohne Spiel in der Woche bleibt der Tipp", () => {
    const file = build("JA");
    const ms = tipsForPlayer(file, WEEK.games.slice(1), standings(), "MS", T0);
    expect(ms.tips[0]).toEqual(file.tips[0]);
  });
});
