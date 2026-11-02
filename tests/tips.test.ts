import { describe, expect, it } from "vitest";
import type { Game, WeekFile } from "../src/core/schema";
import {
  buildTipsFile,
  chooseDeviations,
  erf,
  gapToTarget,
  favoriteTip,
  homeWinProbability,
  isLocked,
  maxDeviations,
  normalCdf,
  remainingWeeks,
  sameTipsContent,
  tiebreakerFor,
  tiebreakerGames,
  tipLevel,
  weekdayNewYork,
} from "../src/core/tips";
import { TipsFileSchema, type GameTip, type Odds, type StandingsFile } from "../src/core/tips-schema";

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
const BEHIND = standings({ MS: 71, JA: 45 }); // 26 Punkte Rückstand in Week 9, 2.6 pro Woche ergibt 2 Abweichungen
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

describe("maxDeviations nach D026", () => {
  it("Restwochen inklusive aktueller Woche", () => {
    expect(remainingWeeks(2, 9)).toBe(10);
    expect(remainingWeeks(2, 18)).toBe(1);
    expect(remainingWeeks(2, 20)).toBe(1);
    expect(remainingWeeks(3, 2)).toBe(1);
  });
  it("Grenzen Rückstand pro Restwoche bei 10 Restwochen", () => {
    expect(maxDeviations(0, 2, 9)).toBe(0);
    expect(maxDeviations(10, 2, 9)).toBe(0); // 1.0
    expect(maxDeviations(11, 2, 9)).toBe(1); // 1.1
    expect(maxDeviations(20, 2, 9)).toBe(1); // 2.0
    expect(maxDeviations(21, 2, 9)).toBe(2); // 2.1
  });
  it("letzte 3 Wochen mit über 2 Punkten Rückstand ergibt 3", () => {
    expect(maxDeviations(3, 2, 16)).toBe(3);
    expect(maxDeviations(3, 2, 15)).toBe(0); // 4 Restwochen, 0.75 pro Woche
    expect(maxDeviations(5, 2, 15)).toBe(1); // 4 Restwochen, 1.25 pro Woche
  });
  it("Saisonende Grenzen", () => {
    expect(maxDeviations(2, 2, 16)).toBe(0); // 3 Restwochen, 0.67 pro Woche
    expect(maxDeviations(2, 2, 18)).toBe(1); // 1 Restwoche, 2.0 pro Woche
    expect(maxDeviations(1, 2, 18)).toBe(0);
    expect(maxDeviations(3, 2, 18)).toBe(3);
  });
  it("Postseason wie letzte 3 Wochen", () => {
    expect(maxDeviations(3, 3, 1)).toBe(3);
    expect(maxDeviations(2, 3, 1)).toBe(1);
    expect(maxDeviations(0, 3, 1)).toBe(0);
  });
  it("heutiger Stand: JA 45, Ziel MS 71 auf Platz 1, Week 9 ergibt 2 (D028)", () => {
    const today = standings({ MS: 71, LM: 69, DH: 68, CZ: 51, JA: 45 });
    expect(gapToTarget(today)).toBe(26);
    expect(maxDeviations(gapToTarget(today), 2, 9)).toBe(2);
  });
  it("Ziel ist immer Platz 1 (D028)", () => {
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

function tip(gameId: string, pickProb: number | null, extra: Partial<GameTip> = {}): GameTip {
  return {
    gameId,
    kickoffUtc: "2026-11-08T18:00:00Z",
    odds: null,
    pHome: pickProb,
    pickTeamId: pickProb === null ? null : `h${gameId}`,
    pickProb,
    level: tipLevel(pickProb),
    deviation: false,
    firstPickTeamId: null,
    changedSinceFirst: false,
    locked: false,
    lockedAt: null,
    ...extra,
  };
}

describe("Abweichungen", () => {
  it("wählt die unklaren Spiele mit kleinster Favoritenwahrscheinlichkeit", () => {
    const tips = [tip("1", 0.59), tip("2", 0.52), tip("3", 0.8), tip("4", 0.55), tip("5", 0.65), tip("6", null)];
    expect([...chooseDeviations(tips, 2)].sort()).toEqual(["2", "4"]);
    expect(chooseDeviations(tips, 0).size).toBe(0);
    expect([...chooseDeviations(tips, 5)].sort()).toEqual(["1", "2", "4"]);
  });
  it("nie gesperrte Spiele, gesperrte Abweichungen zählen gegen das Budget", () => {
    const tips = [
      tip("1", 0.51, { locked: true, lockedAt: T0 }),
      tip("2", 0.55),
      tip("3", 0.58, { locked: true, lockedAt: T0, deviation: true }),
      tip("4", 0.57),
    ];
    expect([...chooseDeviations(tips, 2)]).toEqual(["2"]);
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

  it("erster Lauf: Favoriten, Abweichungen, Grundtipp, Tiebreaker", () => {
    const f = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    expect(f.maxDeviations).toBe(2);
    const by = Object.fromEntries(f.tips.map((t) => [t.gameId, t]));
    // unklar: a (0.5879), b (0.5735), mon (0.5735). Kleinste zuerst, bei Gleichstand nach Kickoff.
    expect(by.b).toMatchObject({ deviation: true, pickTeamId: "ab", pickProb: 0.4265, level: "unklar" });
    expect(by.mon).toMatchObject({ deviation: true, pickTeamId: "hmon" });
    expect(by.a).toMatchObject({ deviation: false, pickTeamId: "ha" });
    expect(by.c).toMatchObject({ level: "klar", pickTeamId: "hc" });
    expect(by.d).toMatchObject({ level: "offen", pickTeamId: null, firstPickTeamId: null });
    // Grundtipp ist immer der Favorit vor der Abweichung (D023)
    expect(by.b).toMatchObject({ firstPickTeamId: "hb", changedSinceFirst: true });
    expect(by.c).toMatchObject({ firstPickTeamId: "hc", changedSinceFirst: false });
    expect(f.tiebreakers.map((t) => t.slot)).toEqual(["thursday", "monday"]);
    expect(f.tiebreakers[0]).toMatchObject({ gameId: "thu", homePoints: 18, awayPoints: 26 });
    // Montagsspiel ist Abweichung: getipptes Heimteam gewinnt 25 zu 22
    expect(f.tiebreakers[1]).toMatchObject({ gameId: "mon", homePoints: 25, awayPoints: 22 });
  });

  it("ohne Rückstand keine Abweichung", () => {
    const f = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: T0 });
    expect(f.maxDeviations).toBe(0);
    expect(f.tips.some((t) => t.deviation)).toBe(false);
  });

  it("maxDeviations bleibt pro Woche eingefroren, Abweichungen werden mit dem Wert neu gewählt", () => {
    const first = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: LEADER, existing: null, now: T0 });
    expect(first.maxDeviations).toBe(0);
    // Neue Rangliste mit Rückstand während der Woche wirkt erst ab der nächsten Woche.
    const again = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: first, now: T0 });
    expect(again.maxDeviations).toBe(0);
    expect(again.tips.some((t) => t.deviation)).toBe(false);
    // Umgekehrt bleibt der eingefrorene Wert 2, die Abweichungen folgen den neuen Quoten.
    const behind = buildTipsFile({ week: weekOf(games), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    const moved = { ...baseOdds, a: odds(-1), b: odds(-7) };
    const next = buildTipsFile({ week: weekOf(games), odds: moved, standings: LEADER, existing: behind, now: T0 });
    expect(next.maxDeviations).toBe(2);
    expect(next.tips.filter((t) => t.deviation).map((t) => t.gameId).sort()).toEqual(["a", "mon"]);
    // Andere Woche rechnet neu.
    const otherWeek = buildTipsFile({ week: { ...weekOf(games), week: 10 }, odds: baseOdds, standings: BEHIND, existing: first, now: T0 });
    expect(otherWeek.maxDeviations).toBeGreaterThan(0);
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

  it("gesperrte Abweichung bleibt und zählt gegen das Budget", () => {
    const g2 = games.map((g) => (g.id === "b" ? { ...g, kickoffUtc: "2026-11-07T18:00:00Z" } : g));
    const first = buildTipsFile({ week: weekOf(g2), odds: baseOdds, standings: BEHIND, existing: null, now: T0 });
    expect(first.tips.find((t) => t.gameId === "b")!.deviation).toBe(true);
    const next = buildTipsFile({ week: weekOf(g2), odds: baseOdds, standings: BEHIND, existing: first, now: "2026-11-07T19:00:00Z" });
    expect(next.tips.find((t) => t.gameId === "b")).toMatchObject({ deviation: true, locked: true });
    expect(next.tips.filter((t) => t.deviation).map((t) => t.gameId).sort()).toEqual(["b", "mon"]);
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
