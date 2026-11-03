import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Game, WeekFile } from "../src/core/schema";
import {
  buildTipsFile,
  erf,
  gapToTarget,
  favoriteTip,
  homeWinProbability,
  isLocked,
  normalCdf,
  sameTipsContent,
  tiebreakerFor,
  tiebreakerGames,
  tipLevel,
  weekdayNewYork,
} from "../src/core/tips";
import { TipsFileSchema, type Odds, type StandingsFile } from "../src/core/tips-schema";

const T0 = "2026-11-01T12:00:00Z";

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

const odds = (spreadHome: number, overUnder: number | null = 45, fetchedAt = T0): Odds => ({
  provider: "DraftKings",
  spreadHome,
  overUnder,
  fetchedAt,
});

function weekOf(games: Game[]): WeekFile {
  return {
    schemaVersion: 1,
    season: 2026,
    seasonType: 2,
    week: 9,
    fetchedAt: T0,
    source: "espn",
    games,
    byeTeamIds: [],
  };
}

function standings(points: Record<string, number>, me = "JA"): StandingsFile {
  return {
    schemaVersion: 1,
    asOfWeek: 8,
    updatedAt: T0,
    me,
    players: Object.entries(points).map(([id, p]) => ({ id, points: p })),
  };
}
const BEHIND = standings({ MS: 71, JA: 45 }); // 26 Punkte Rückstand, seit D052 ohne Einfluss auf die Tipps
const LEADER = standings({ MS: 40, JA: 45 });

describe("Normalverteilung", () => {
  it("erf an bekannten Werten", () => {
    expect(erf(0)).toBeCloseTo(0, 7);
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6);
  });
  it("Phi(0) = 0.5 und Phi(1) = 0.8413", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.841345, 5);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975002, 5);
  });
});

describe("Siegwahrscheinlichkeit", () => {
  it("Spread 0 ergibt 0.5", () => {
    expect(homeWinProbability(0)).toBeCloseTo(0.5, 7);
  });
  it("Spread -3 und -10 aus Heimsicht", () => {
    expect(homeWinProbability(-3)).toBeCloseTo(0.5879, 4);
    expect(homeWinProbability(-10)).toBeCloseTo(0.7706, 4);
  });
  it("Vorzeichen: positiver Spread heisst Auswärtsfavorit", () => {
    expect(homeWinProbability(8.5)).toBeCloseTo(0.2645, 4);
    expect(homeWinProbability(3) + homeWinProbability(-3)).toBeCloseTo(1, 7);
  });
  it("Tipp Heimfavorit, Auswärtsfavorit, Pick'em und fehlende Quote", () => {
    const g = game("1", "2026-11-08T18:00:00Z");
    expect(favoriteTip(g, odds(-10))).toMatchObject({ pickTeamId: "h1", pickProb: 0.7706, level: "klar" });
    expect(favoriteTip(g, odds(8.5))).toMatchObject({ pickTeamId: "a1", pickProb: 0.7355, level: "favorit" });
    expect(favoriteTip(g, odds(0))).toMatchObject({ pickTeamId: "h1", pickProb: 0.5, level: "unklar" });
    expect(favoriteTip(g, null)).toEqual({ pHome: null, pickTeamId: null, pickProb: null, level: "offen" });
  });
});

describe("Lage", () => {
  it("Grenzen 0.75 und 0.60", () => {
    expect(tipLevel(0.75)).toBe("klar");
    expect(tipLevel(0.7499)).toBe("favorit");
    expect(tipLevel(0.6)).toBe("favorit");
    expect(tipLevel(0.5999)).toBe("unklar");
    expect(tipLevel(null)).toBe("offen");
  });
});

describe("Rückstand auf Platz 1, nur Information (D052)", () => {
  it("Rückstand auf die Spitze, in Führung 0", () => {
    expect(gapToTarget(standings({ MS: 71, LM: 69, DH: 68, CZ: 51, JA: 45 }))).toBe(26);
    expect(gapToTarget(BEHIND)).toBe(26);
    expect(gapToTarget(LEADER)).toBe(0);
    expect(gapToTarget(standings({ MS: 50, JA: 50 }))).toBe(0);
    expect(gapToTarget(standings({ MS: 60, LM: 52, DH: 52, JA: 50 }))).toBe(10);
    expect(() => gapToTarget(standings({ MS: 1 }))).toThrow("JA");
  });
});

describe("Sperre", () => {
  it("ab Kickoff oder wenn nicht mehr geplant", () => {
    const g = game("1", "2026-11-08T18:00:00Z");
    expect(isLocked(g, "2026-11-08T17:59:59Z")).toBe(false);
    expect(isLocked(g, "2026-11-08T18:00:00Z")).toBe(true);
    expect(isLocked({ ...g, status: "postponed" }, T0)).toBe(true);
  });
});

describe("Tiebreaker", () => {
  const g = game("1", "2026-11-06T01:15:00Z");
  it("mit Over/Under, Auswärtsfavorit", () => {
    expect(tiebreakerFor(g, odds(8.5, 43.5), "thursday")).toEqual({
      gameId: "1",
      slot: "thursday",
      homePoints: 18,
      awayPoints: 26,
      basis: "quote",
    });
  });
  it("mit Over/Under, Heimfavorit", () => {
    expect(tiebreakerFor(g, odds(-10, 45.5), "monday")).toMatchObject({ homePoints: 28, awayPoints: 18, basis: "quote" });
  });
  it("Favorit liegt nach Rundung nie gleichauf", () => {
    const tb = tiebreakerFor(g, odds(-0.5, 40), "monday");
    expect(tb.homePoints).toBeGreaterThan(tb.awayPoints);
  });
  it("Abweichung: getippter Aussenseiter gewinnt mit 3 Punkten bei gleichem Total", () => {
    const tb = tiebreakerFor(g, odds(2.5, 46.5), "monday", { pickTeamId: "h1", deviation: true });
    expect(tb).toMatchObject({ homePoints: 25, awayPoints: 22, basis: "quote" });
    const std = tiebreakerFor(g, odds(-3, null), "monday", { pickTeamId: "a1", deviation: true });
    expect(std).toMatchObject({ homePoints: 20, awayPoints: 23, basis: "standard" });
    const even = tiebreakerFor(g, odds(-3, 44), "monday", { pickTeamId: "a1", deviation: true });
    expect(even.awayPoints - even.homePoints).toBe(3);
  });
  it("ohne Abweichung folgt der Sieger dem Tipp wie dem Favoriten", () => {
    expect(tiebreakerFor(g, odds(0, 40), "monday", { pickTeamId: "h1", deviation: false })).toMatchObject({ homePoints: 21, awayPoints: 20 });
  });
  it("ohne Over/Under 23 zu 20 für den Favoriten", () => {
    expect(tiebreakerFor(g, odds(3, null), "thursday")).toMatchObject({ homePoints: 20, awayPoints: 23, basis: "standard" });
    expect(tiebreakerFor(g, null, "thursday")).toMatchObject({ homePoints: 23, awayPoints: 20, basis: "standard" });
  });
});

describe("Auswahl TNF und MNF (D025)", () => {
  it("Wochentag in America/New_York", () => {
    expect(weekdayNewYork("2026-11-06T01:15:00Z")).toBe("Thu");
    expect(weekdayNewYork("2026-11-10T01:15:00Z")).toBe("Mon");
  });
  it("normale Woche: Donnerstag und Montag", () => {
    const games = [
      game("sun", "2026-11-08T18:00:00Z"),
      game("mon", "2026-11-10T01:15:00Z"),
      game("thu", "2026-11-06T01:15:00Z"),
      game("snf", "2026-11-09T01:20:00Z"),
    ];
    expect(tiebreakerGames(games).map((t) => [t.slot, t.game.id])).toEqual([
      ["thursday", "thu"],
      ["monday", "mon"],
    ]);
  });
  it("Thanksgiving mit 3 Donnerstagsspielen: das späteste", () => {
    const games = [
      game("t1", "2026-11-26T17:30:00Z"),
      game("t3", "2026-11-27T01:20:00Z"),
      game("t2", "2026-11-26T21:30:00Z"),
      game("fri", "2026-11-27T20:00:00Z"),
      game("mon", "2026-12-01T01:15:00Z"),
    ];
    expect(tiebreakerGames(games).map((t) => [t.slot, t.game.id])).toEqual([
      ["thursday", "t3"],
      ["monday", "mon"],
    ]);
  });
  it("Doppel Monday Night: das späteste", () => {
    const games = [
      game("thu", "2026-09-11T00:15:00Z"),
      game("m2", "2026-09-15T02:15:00Z"),
      game("m1", "2026-09-14T23:00:00Z"),
    ];
    expect(tiebreakerGames(games).map((t) => [t.slot, t.game.id])).toEqual([
      ["thursday", "thu"],
      ["monday", "m2"],
    ]);
  });
  it("Woche ohne Donnerstagsspiel liefert nur Montag", () => {
    const games = [game("sun", "2026-09-13T17:00:00Z"), game("mon", "2026-09-15T00:15:00Z")];
    expect(tiebreakerGames(games).map((t) => t.slot)).toEqual(["monday"]);
  });
  it("verschobene und abgesagte Spiele scheiden vor der Wahl des spätesten aus", () => {
    const games = [
      game("t1", "2026-11-26T17:30:00Z"),
      game("t2", "2026-11-26T21:30:00Z"),
      game("t3", "2026-11-27T01:20:00Z", { status: "postponed" }),
      game("m1", "2026-11-30T23:00:00Z"),
      game("m2", "2026-12-01T01:15:00Z", { status: "canceled" }),
    ];
    expect(tiebreakerGames(games).map((t) => [t.slot, t.game.id])).toEqual([
      ["thursday", "t2"],
      ["monday", "m1"],
    ]);
  });
  it("einziges Montagsspiel abgesagt liefert nur Donnerstag", () => {
    const games = [game("thu", "2026-11-06T01:15:00Z"), game("mon", "2026-11-10T01:15:00Z", { status: "canceled" })];
    expect(tiebreakerGames(games).map((t) => t.slot)).toEqual(["thursday"]);
  });
  it("Woche ohne Donnerstag und Montag liefert keine", () => {
    expect(tiebreakerGames([game("sat", "2027-01-09T21:30:00Z")])).toEqual([]);
  });
});

describe("buildTipsFile", () => {
  const games = [
    game("thu", "2026-11-06T01:15:00Z"),
    game("a", "2026-11-08T18:00:00Z"),
    game("b", "2026-11-08T18:00:00Z"),
    game("c", "2026-11-08T21:25:00Z"),
    game("d", "2026-11-09T01:20:00Z"),
    game("mon", "2026-11-10T01:15:00Z"),
  ];
  const baseOdds = {
    thu: odds(8.5, 43.5),
    a: odds(-3),
    b: odds(-2.5),
    c: odds(-10),
    d: null,
    mon: odds(2.5, 46.5),
  };

  it("leere Woche", () => {
    const f = buildTipsFile({ week: weekOf([]), odds: {}, standings: BEHIND, existing: null, now: T0 });
    expect(f.tips).toEqual([]);
    expect(f.tiebreakers).toEqual([]);
    expect(TipsFileSchema.safeParse(f).success).toBe(true);
  });

  it("erster Lauf: immer Favoriten, Grundtipp, Tiebreaker folgt dem Favoriten (D052)", () => {
    const f = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    // Auch mit 26 Punkten Rückstand keine Abweichung, das Feld bleibt im Datenvertrag mit 0
    expect(f.maxDeviations).toBe(0);
    expect(f.tips.some((t) => t.deviation)).toBe(false);
    const by = Object.fromEntries(f.tips.map((t) => [t.gameId, t]));
    expect(by.b).toMatchObject({ deviation: false, pickTeamId: "hb", pickProb: 0.5735, level: "unklar" });
    expect(by.mon).toMatchObject({ deviation: false, pickTeamId: "amon" });
    expect(by.a).toMatchObject({ deviation: false, pickTeamId: "ha" });
    expect(by.c).toMatchObject({ level: "klar", pickTeamId: "hc" });
    expect(by.d).toMatchObject({ level: "offen", pickTeamId: null, firstPickTeamId: null });
    expect(by.b).toMatchObject({ firstPickTeamId: "hb", changedSinceFirst: false });
    expect(f.tiebreakers.map((t) => t.slot)).toEqual(["thursday", "monday"]);
    expect(f.tiebreakers[0]).toMatchObject({ gameId: "thu", homePoints: 18, awayPoints: 26 });
    // Montagsspiel: Auswärtsfavorit gewinnt nach Spread und Over/Under 25 zu 22
    expect(f.tiebreakers[1]).toMatchObject({ gameId: "mon", homePoints: 22, awayPoints: 25 });
  });

  it("Rangliste ändert nichts an den Tipps", () => {
    const behind = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    const leader = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: T0 });
    expect(sameTipsContent(behind, leader)).toBe(true);
  });

  // Datei aus der Zeit vor D052 mit eingefrorenen Abweichungen, wie Week 9 am 2026-11-02
  function legacyFile(now: string) {
    const f = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    const flip = (id: string, dog: string, prob: number) =>
      f.tips.map((t) => (t.gameId === id ? { ...t, pickTeamId: dog, pickProb: prob, deviation: true, changedSinceFirst: true } : t));
    const tips = flip("b", "ab", 0.4265);
    const withMon = tips.map((t) => (t.gameId === "mon" ? { ...t, pickTeamId: "hmon", pickProb: 0.4265, deviation: true, changedSinceFirst: true } : t));
    return {
      ...f,
      updatedAt: now,
      maxDeviations: 2,
      tips: withMon,
      tiebreakers: f.tiebreakers.map((tb) => (tb.slot === "monday" ? { ...tb, homePoints: 25, awayPoints: 22 } : tb)),
    };
  }

  it("eingefrorene Abweichungen nicht gesperrter Spiele werden verworfen (D052)", () => {
    const legacy = legacyFile(T0);
    const next = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: legacy, now: T0 });
    expect(next.maxDeviations).toBe(0);
    expect(next.tips.some((t) => t.deviation)).toBe(false);
    // Zurück zum Favoriten, Grundtipp war schon der Favorit, darum keine Änderungsmarke
    expect(next.tips.find((t) => t.gameId === "b")).toMatchObject({ pickTeamId: "hb", firstPickTeamId: "hb", changedSinceFirst: false });
    expect(next.tips.find((t) => t.gameId === "mon")).toMatchObject({ pickTeamId: "amon", firstPickTeamId: "amon", changedSinceFirst: false });
    expect(next.tips.some((t) => t.changedSinceFirst)).toBe(false);
    // Tiebreaker folgt wieder dem Favoriten
    expect(next.tiebreakers[1]).toMatchObject({ gameId: "mon", homePoints: 22, awayPoints: 25 });
    expect(TipsFileSchema.safeParse(next).success).toBe(true);
  });

  it("gesperrte Abweichung aus der Zeit vor D052 bleibt unverändert", () => {
    const g2 = games.map((g) => (g.id === "b" ? { ...g, kickoffUtc: "2026-11-07T18:00:00Z" } : g));
    const legacy = { ...legacyFile(T0) };
    const afterB = "2026-11-07T19:00:00Z";
    const next = buildTipsFile({ week: weekOf(g2), odds: baseOdds, standings: BEHIND, existing: legacy, now: afterB });
    const prevB = legacy.tips.find((t) => t.gameId === "b")!;
    expect(next.tips.find((t) => t.gameId === "b")).toEqual({ ...prevB, locked: true, lockedAt: afterB });
    // Nur das gesperrte Spiel behält die Abweichung
    expect(next.tips.filter((t) => t.deviation).map((t) => t.gameId)).toEqual(["b"]);
    expect(next.maxDeviations).toBe(0);
  });

  it("Grundtipp bleibt und Änderung wird markiert", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: T0 });
    const later = "2026-11-03T12:00:00Z";
    const next = buildTipsFile({
      week: weekOf(games),
      odds: { ...baseOdds, c: odds(4, 45, later) },
      standings: LEADER,
      existing: first,
      now: later,
    });
    const c = next.tips.find((t) => t.gameId === "c")!;
    expect(c).toMatchObject({ pickTeamId: "ac", firstPickTeamId: "hc", changedSinceFirst: true });
    expect(c.odds!.fetchedAt).toBe(later);
    // Unveränderte Quote behält den Zeitstempel
    expect(next.tips.find((t) => t.gameId === "a")!.odds!.fetchedAt).toBe(T0);
  });

  it("Grundtipp wird erst mit Quote gesetzt", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: T0 });
    const next = buildTipsFile({ week: weekOf(games), odds: { ...baseOdds, d: odds(-7) }, standings: LEADER, existing: first, now: T0 });
    expect(next.tips.find((t) => t.gameId === "d")).toMatchObject({ firstPickTeamId: "hd", changedSinceFirst: false });
  });

  it("kurzzeitig fehlende Quote vor Kickoff behält die letzte", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: T0 });
    const next = buildTipsFile({ week: weekOf(games), odds: { ...baseOdds, c: null }, standings: LEADER, existing: first, now: T0 });
    expect(next.tips.find((t) => t.gameId === "c")).toEqual(first.tips.find((t) => t.gameId === "c"));
  });

  it("Sperre verhindert Neuberechnung von Tipp und Tiebreaker", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    const afterThu = "2026-11-06T02:00:00Z";
    const changed = { ...baseOdds, thu: odds(-14, 50), b: odds(-2.5) };
    const next = buildTipsFile({ week: weekOf(games), odds: changed, standings: BEHIND, existing: first, now: afterThu });
    const thu = next.tips.find((t) => t.gameId === "thu")!;
    const prevThu = first.tips.find((t) => t.gameId === "thu")!;
    expect(thu).toEqual({ ...prevThu, locked: true, lockedAt: afterThu });
    expect(next.tiebreakers[0]).toEqual(first.tiebreakers[0]);
    // Ein weiterer Lauf übernimmt den gesperrten Tipp unverändert, auch lockedAt
    const third = buildTipsFile({ week: weekOf(games), odds: changed, standings: BEHIND, existing: next, now: "2026-11-07T00:00:00Z" });
    expect(third.tips.find((t) => t.gameId === "thu")).toEqual(thu);
  });

  it("gesperrter Tiebreaker bleibt, wenn sein Spiel danach unterbrochen wird", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    const afterThu = "2026-11-06T02:00:00Z";
    const locked = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: first, now: afterThu });
    const suspended = games.map((g) => (g.id === "thu" ? { ...g, status: "postponed" as const } : g));
    const next = buildTipsFile({ week: weekOf(suspended), odds: baseOdds, standings: BEHIND, existing: locked, now: afterThu });
    expect(next.tiebreakers.map((t) => t.slot)).toEqual(["thursday", "monday"]);
    expect(next.tiebreakers[0]).toEqual(first.tiebreakers[0]);
  });

  it("beim ersten Lauf gesperrt ohne Vorgänger: nicht_erfasst, kein Tiebreaker", () => {
    const afterThu = "2026-11-06T02:00:00Z";
    const f = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: afterThu });
    expect(f.tips.find((t) => t.gameId === "thu")).toMatchObject({
      level: "nicht_erfasst",
      pickTeamId: null,
      pHome: null,
      odds: null,
      firstPickTeamId: null,
      locked: true,
    });
    expect(f.tiebreakers.map((t) => t.slot)).toEqual(["monday"]);
    // Später unverändert übernommen
    const next = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: f, now: "2026-11-07T00:00:00Z" });
    expect(next.tips.find((t) => t.gameId === "thu")).toEqual(f.tips.find((t) => t.gameId === "thu"));
    expect(TipsFileSchema.safeParse(next).success).toBe(true);
  });

  it("gleiche Eingabe ergibt gleichen Inhalt", () => {
    const a = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    const b = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: a, now: "2026-11-02T00:00:00Z" });
    expect(sameTipsContent(a, b)).toBe(true);
  });
});

describe("Linienbewegung firstOdds (D050)", () => {
  const games = [game("thu", "2026-11-06T01:15:00Z"), game("sun", "2026-11-08T18:00:00Z")];
  const T1 = "2026-11-03T12:00:00Z";
  const T2 = "2026-11-06T02:00:00Z";

  it("erste Quote wird gesetzt und bleibt bei Bewegung unverändert", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: { thu: odds(3), sun: null }, standings: BEHIND, existing: null, now: T0 });
    expect(first.schemaVersion).toBe(2);
    const by1 = Object.fromEntries(first.tips.map((t) => [t.gameId, t]));
    expect(by1.thu!.firstOdds).toEqual(odds(3));
    expect(by1.sun!.firstOdds).toBeNull();

    const second = buildTipsFile({ week: weekOf(games), odds: { thu: odds(8.5, 45, T1), sun: odds(-2, 45, T1) }, standings: BEHIND, existing: first, now: T1 });
    const by2 = Object.fromEntries(second.tips.map((t) => [t.gameId, t]));
    expect(by2.thu!.odds?.spreadHome).toBe(8.5);
    expect(by2.thu!.firstOdds).toEqual(odds(3));
    // Erste Quote erst im zweiten Lauf
    expect(by2.sun!.firstOdds).toEqual(odds(-2, 45, T1));

    // Nach Kickoff gesperrt, erste Quote bleibt
    const third = buildTipsFile({ week: weekOf(games), odds: { thu: odds(1, 45, T2), sun: odds(-2, 45, T1) }, standings: BEHIND, existing: second, now: T2 });
    const thu = third.tips.find((t) => t.gameId === "thu")!;
    expect(thu.locked).toBe(true);
    expect(thu.firstOdds).toEqual(odds(3));
    expect(thu.odds?.spreadHome).toBe(8.5);
  });

  it("Datei aus Version 1 ohne firstOdds: die gespeicherte Quote gilt als erste", () => {
    const v1 = buildTipsFile({ week: weekOf(games), odds: { thu: odds(3), sun: odds(-1) }, standings: BEHIND, existing: null, now: T0 });
    const old = { ...v1, schemaVersion: 1 as const, tips: v1.tips.map(({ firstOdds: _f, ...t }) => t) };
    expect(TipsFileSchema.parse(old).schemaVersion).toBe(1);
    const next = buildTipsFile({ week: weekOf(games), odds: { thu: odds(6, 45, T1), sun: odds(-1) }, standings: BEHIND, existing: TipsFileSchema.parse(old), now: T1 });
    expect(next.schemaVersion).toBe(2);
    expect(next.tips.find((t) => t.gameId === "thu")!.firstOdds).toEqual(odds(3));
  });

  it("Fixture aus Version 1 parst weiter", () => {
    const raw = JSON.parse(readFileSync(new URL("./fixtures/tips-2026-2-08.json", import.meta.url), "utf8"));
    expect(raw.schemaVersion).toBe(1);
    const f = TipsFileSchema.parse(raw);
    expect(f.tips.every((t) => t.firstOdds === undefined)).toBe(true);
  });

  it("unbekannte Version wird abgelehnt", () => {
    const raw = JSON.parse(readFileSync(new URL("./fixtures/tips-2026-2-09.json", import.meta.url), "utf8"));
    expect(TipsFileSchema.safeParse({ ...raw, schemaVersion: 3 }).success).toBe(false);
  });
});
