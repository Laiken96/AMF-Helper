import { describe, expect, it } from "vitest";
import {
  ASSUMED_GAMES_PER_WEEK,
  calibratePlayers,
  calibrationWeekFrom,
  dogWeights,
  expectedHitRate,
  possibleGamesThrough,
  remainingRegularWeeks,
  simPlayers,
  type CalibrationWeek,
} from "../src/core/calibrate";
import type { ReviewFile, StandingsHistory } from "../src/core/review-schema";
import { buildSimSetup } from "../src/core/season-sim";
import { fpiPickProbLookup } from "../src/core/season";
import { DEFAULT_UPSET_RATE, simulateFirstPlace } from "../src/core/simulate";
import type { GameTip, StandingsFile, TipsFile } from "../src/core/tips-schema";
import { rankingCheckText } from "../src/app/review-text";

const POOL = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

describe("dogWeights und expectedHitRate", () => {
  it("Gewichte haben Mittel 1 und bevorzugen knappe Spiele", () => {
    const w = dogWeights([0.5, 0.75, 1]);
    expect(w.reduce((a, b) => a + b, 0) / w.length).toBeCloseTo(1, 10);
    expect(w[0]!).toBeGreaterThan(w[1]!);
    expect(w[2]).toBe(0);
  });
  it("ohne Aussenseiter Tipps gleich der mittleren Favoritenchance, mit Tipps tiefer", () => {
    expect(expectedHitRate(POOL, 0)).toBeCloseTo(0.675, 10);
    expect(expectedHitRate(POOL, 0.13)).toBeLessThan(0.675);
    expect(expectedHitRate(POOL, 0.13)).toBeGreaterThan(0.6);
  });
});

describe("possibleGamesThrough", () => {
  it("bekannte Wochen mit Spielzahl, übrige mit Annahme", () => {
    const r = possibleGamesThrough(8, new Map([[8, 14]]));
    expect(r.assumedWeeks).toBe(7);
    expect(r.games).toBe(Math.round(7 * ASSUMED_GAMES_PER_WEEK + 14));
  });
});

const history = (entries: { week: number; pts: Record<string, number> }[]): StandingsHistory => ({
  schemaVersion: 1,
  entries: entries.map((e) => ({
    season: 2026,
    seasonType: 2,
    week: e.week,
    reportedAt: "2026-11-02T03:00:00Z",
    players: Object.entries(e.pts).map(([id, points]) => ({ id, points })),
  })),
});

/** Woche mit n Spielen zu je 0.7, Favorit gewinnt in favWins Spielen. */
function calWeek(week: number, n: number, favWins: number): CalibrationWeek {
  return {
    seasonType: 2,
    week,
    games: Array.from({ length: n }, (_, i) => ({ favProb: 0.7, outcome: i < favWins ? ("fav" as const) : ("dog" as const) })),
  };
}

describe("calibratePlayers", () => {
  it("ohne Wochendaten: Tippquote aus dem Total, Aussenseiterquote bleibt Annahme", () => {
    const h = expectedHitRate(POOL, DEFAULT_UPSET_RATE);
    const [full, half] = calibratePlayers({
      season: 2026,
      players: [
        { id: "AA", points: Math.round(100 * h) },
        { id: "BB", points: Math.round(50 * h) },
      ],
      possibleGames: 100,
      probPool: POOL,
    });
    expect(full!.pickRate).toBeCloseTo(1, 1);
    expect(half!.pickRate).toBeCloseTo(0.5, 1);
    expect(full!.upsetRate).toBe(DEFAULT_UPSET_RATE);
    expect(full!.upsetFromData).toBe(false);
  });

  it("Tippquote höchstens 1, ohne mögliche Spiele 1", () => {
    const [a] = calibratePlayers({ season: 2026, players: [{ id: "AA", points: 999 }], possibleGames: 100, probPool: POOL });
    expect(a!.pickRate).toBe(1);
    const [b] = calibratePlayers({ season: 2026, players: [{ id: "AA", points: 5 }], possibleGames: 0 });
    expect(b!.pickRate).toBe(1);
  });

  it("gemeldete Wochen: wer weniger Favoritentreffer holt, bekommt eine höhere Aussenseiterquote", () => {
    // 4 Wochen zu 16 Spielen, Favorit gewinnt je 11. Favoritentipper holt 11, Streuer 8.
    const weeks = [9, 10, 11, 12].map((w) => calWeek(w, 16, 11));
    const pts = (base: number, perWeek: number) => [8, 9, 10, 11, 12].map((w, i) => ({ week: w, total: base + i * perWeek }));
    const fav = pts(100, 11);
    const spread = pts(100, 8);
    const hist = history(fav.map((f, i) => ({ week: f.week, pts: { FF: f.total, SS: spread[i]!.total } })));
    const [f, s] = calibratePlayers({
      season: 2026,
      players: [
        { id: "FF", points: fav.at(-1)!.total },
        { id: "SS", points: spread.at(-1)!.total },
      ],
      possibleGames: 0, // Tippquote 1, damit nur die Aussenseiterquote geschätzt wird
      history: hist,
      weeks,
    });
    expect(f!.upsetFromData).toBe(true);
    expect(f!.upsetGames).toBe(64);
    expect(f!.upsetRaw).toBe(0);
    expect(s!.upsetRaw!).toBeGreaterThan(0.3);
    // gestaucht zur Annahme hin, aber über ihr
    expect(s!.upsetRate).toBeGreaterThan(DEFAULT_UPSET_RATE);
    expect(s!.upsetRate).toBeLessThan(s!.upsetRaw!);
    expect(f!.upsetRate).toBeLessThan(DEFAULT_UPSET_RATE);
  });

  it("Woche ohne gemeldete Vorwoche zählt nicht", () => {
    const hist = history([{ week: 9, pts: { FF: 50 } }]);
    const [f] = calibratePlayers({
      season: 2026,
      players: [{ id: "FF", points: 50 }],
      possibleGames: 0,
      history: hist,
      weeks: [calWeek(9, 16, 11)],
    });
    expect(f!.upsetFromData).toBe(false);
    expect(f!.upsetRate).toBe(DEFAULT_UPSET_RATE);
  });

  it("Kalibrierung trifft eine simulierte Streuquote ungefähr", () => {
    // Gegner mit u = 0.3 über 10 Wochen, Ausgang aus der Simulation nachgebaut
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const weeks: CalibrationWeek[] = [];
    const totals = [0];
    for (let w = 1; w <= 10; w++) {
      const games = Array.from({ length: 16 }, () => {
        const p = 0.55 + rand() * 0.35;
        return { favProb: p, outcome: rand() < p ? ("fav" as const) : ("dog" as const) };
      });
      const wts = dogWeights(games.map((g) => g.favProb));
      let pts = 0;
      games.forEach((g, i) => {
        const dog = rand() < 0.3 * wts[i]!;
        if ((g.outcome === "dog") === dog) pts++;
      });
      weeks.push({ seasonType: 2, week: w, games });
      totals.push(totals.at(-1)! + pts);
    }
    const hist = history(totals.slice(1).map((t, i) => ({ week: i + 1, pts: { XX: t } })));
    const [x] = calibratePlayers({ season: 2026, players: [{ id: "XX", points: totals.at(-1)! }], possibleGames: 0, history: hist, weeks, prior: 0.13 });
    expect(x!.upsetRaw!).toBeGreaterThan(0.15);
    expect(x!.upsetRaw!).toBeLessThan(0.5);
  });
});

describe("calibrationWeekFrom", () => {
  const tip = (id: string, pHome: number | null, fav: string | null) => ({ gameId: id, pHome, firstPickTeamId: fav });
  const review = (games: ReviewFile["games"], complete = true) => ({ seasonType: 2, week: 9, complete, games });
  const g = (id: string, winner: string | null, final = true) => ({
    gameId: id,
    pickTeamId: null,
    favoriteTeamId: null,
    winnerTeamId: winner,
    final,
    correct: null,
    deviation: false,
    deviationEffect: null,
  });

  it("Favorit, Aussenseiter und Unentschieden", () => {
    const w = calibrationWeekFrom(review([g("1", "H1"), g("2", "A2"), g("3", null)]), {
      tips: [tip("1", 0.7, "H1"), tip("2", 0.4, "H2"), tip("3", 0.5, "H3")],
    });
    expect(w!.games.map((x) => x.outcome)).toEqual(["fav", "dog", "tie"]);
    expect(w!.games[1]!.favProb).toBeCloseTo(0.6, 10);
  });

  it("unvollständige Woche oder Spiel ohne Quote ergibt null", () => {
    expect(calibrationWeekFrom(review([g("1", "H1")], false), { tips: [tip("1", 0.7, "H1")] })).toBeNull();
    expect(calibrationWeekFrom(review([g("1", "H1")]), { tips: [tip("1", null, null)] })).toBeNull();
    expect(calibrationWeekFrom(review([g("1", "H1")]), null)).toBeNull();
  });
});

describe("simPlayers und Restwochen", () => {
  it("alle mit derselben geschätzten Tippquote, eigener Spieler nicht als Einziger mit 100 Prozent (D052)", () => {
    const cal = [
      { id: "JA", points: 45, pickRate: 0.6, pickRateFromData: true, upsetRate: 0.13, upsetFromData: false, upsetGames: 0, upsetRaw: null },
      { id: "MS", points: 71, pickRate: 0.95, pickRateFromData: true, upsetRate: 0.2, upsetFromData: true, upsetGames: 32, upsetRaw: 0.3 },
    ];
    expect(simPlayers(cal, "JA")).toEqual([
      { id: "JA", points: 45, pickRate: 0.6 },
      { id: "MS", points: 71, pickRate: 0.95, upsetRate: 0.2 },
    ]);
    // Zweite Variante: alle tippen jedes Spiel
    expect(simPlayers(cal, "JA", "voll")).toEqual([
      { id: "JA", points: 45, pickRate: 1 },
      { id: "MS", points: 71, pickRate: 1, upsetRate: 0.2 },
    ]);
  });
  it("Regular Season bis Week 18, Postseason 0", () => {
    expect(remainingRegularWeeks(2, 8)).toBe(10);
    expect(remainingRegularWeeks(2, 18)).toBe(0);
    expect(remainingRegularWeeks(3, 1)).toBe(0);
  });
});

const standings = (over: Partial<StandingsFile> = {}): StandingsFile => ({
  schemaVersion: 1,
  asOfWeek: 8,
  updatedAt: "2026-11-02T03:00:00Z",
  me: "JA",
  players: [
    { id: "MS", points: 71 },
    { id: "LM", points: 69 },
    { id: "DH", points: 68 },
    { id: "CZ", points: 51 },
    { id: "JA", points: 45 },
  ],
  ...over,
});

const tipsFile = (week: number, probs: number[]): TipsFile => ({
  schemaVersion: 1,
  season: 2026,
  seasonType: 2,
  week,
  updatedAt: "2026-11-02T00:00:00Z",
  maxDeviations: 0,
  tiebreakers: [],
  tips: probs.map(
    (p, i) =>
      ({
        gameId: `${week}-${i}`,
        kickoffUtc: "2026-11-08T18:00:00Z",
        odds: null,
        pHome: p,
        pickTeamId: `H${i}`,
        pickProb: p,
        level: "favorit",
        deviation: false,
        firstPickTeamId: `H${i}`,
        changedSinceFirst: false,
        locked: false,
        lockedAt: null,
      }) as GameTip,
  ),
});

describe("buildSimSetup", () => {
  const base = { season: 2026, history: history([{ week: 8, pts: { JA: 45 } }]), reviews: [], tips: [tipsFile(9, POOL)] };

  it("Stand wie Week 8 der echten Daten: JA etwa 73 Tipps, 10 Wochen offen, Week 9 bekannt", () => {
    const s = buildSimSetup({ ...base, standings: standings() })!;
    expect(s.me).toBe("JA");
    expect(s.remainingWeeks).toBe(10);
    expect(s.input.knownWeeks).toHaveLength(1);
    const ja = s.players.find((p) => p.id === "JA")!;
    // D022: 45 Punkte aus 73 Tipps bei rund 120 möglichen Spielen
    expect(ja.pickRate * s.possibleGames).toBeGreaterThan(65);
    expect(ja.pickRate * s.possibleGames).toBeLessThan(85);
    // Fair (D052): JA bekommt dieselbe geschätzte Tippquote wie die Gegner, nicht 100 Prozent
    expect(s.input.players.find((p) => p.id === "JA")!.pickRate).toBe(ja.pickRate);
    expect(s.input.players.find((p) => p.id === "JA")!.pickRate).toBeLessThan(1);
  });

  it("gewählter Spieler aus dem Onboarding, unbekanntes Kürzel fällt auf me zurück", () => {
    expect(buildSimSetup({ ...base, standings: standings(), me: "CZ" })!.me).toBe("CZ");
    expect(buildSimSetup({ ...base, standings: standings(), me: "XX" })!.me).toBe("JA");
  });

  it("Rangliste einer anderen Saison ergibt null", () => {
    expect(buildSimSetup({ ...base, standings: standings({ schemaVersion: 2, season: 2025 }) })).toBeNull();
  });

  it("Ergebnis: bei 26 Punkten Rückstand ist Platz 1 kaum erreichbar, mehr Abweichungen senken den Endstand", () => {
    const s = buildSimSetup({ ...base, standings: standings(), runs: 2000 })!;
    const out = simulateFirstPlace(s.input);
    expect(out.results.map((r) => r.k)).toEqual([0, 1, 2, 3]);
    for (const r of out.results) expect(r.winChance).toBeLessThan(0.02);
    expect(out.results[0]!.meanPoints).toBeGreaterThan(out.results[3]!.meanPoints);
    // Chance auf jeden Rang summiert sich auf 1, Rang 1 ist die Chance auf Platz 1
    for (const r of out.results) {
      expect(r.rankChances).toHaveLength(5);
      expect(r.rankChances.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
      expect(r.rankChances[0]).toBeCloseTo(r.winChance, 3);
    }
    const full = simulateFirstPlace(buildSimSetup({ ...base, standings: standings(), runs: 2000, pickRates: "voll" })!.input);
    expect(full.results.every((r) => r.winChance < 0.02)).toBe(true);
  });
});

describe("fpiPickProbLookup", () => {
  it("Wahrscheinlichkeit des getippten Teams, sonst null", () => {
    const f = fpiPickProbLookup([{ games: [{ gameId: "1", homeId: "H", awayId: "A", pHome: 0.62, pAway: 0.37 }] }]);
    const t = (id: string, pick: string | null) => ({ gameId: id, pickTeamId: pick }) as GameTip;
    expect(f(t("1", "H"))).toBe(0.62);
    expect(f(t("1", "A"))).toBe(0.37);
    expect(f(t("1", "X"))).toBeNull();
    expect(f(t("2", "H"))).toBeNull();
  });
});

describe("rankingCheckText", () => {
  it("weniger gemeldet als App Tipps", () => {
    expect(rankingCheckText({ playerId: "JA", reported: 9, appPoints: 10, gap: -1 })).toBe(
      "Gemeldet 9, App Tipps 10, Differenz 1: Tipp vergessen oder anders eingetragen?",
    );
  });
  it("mehr gemeldet und gleich", () => {
    expect(rankingCheckText({ playerId: "JA", reported: 11, appPoints: 10, gap: 1 })).toContain("Differenz 1: mehr Punkte");
    expect(rankingCheckText({ playerId: "JA", reported: 10, appPoints: 10, gap: 0 })).toBe("Gemeldet 10, App Tipps 10: stimmt überein.");
  });
});
