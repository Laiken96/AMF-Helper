import { describe, expect, it } from "vitest";
import { DEFAULT_PROB_POOL, mulberry32, observedPickRate, simulateFirstPlace } from "../src/core/simulate";

// Stand nach Week 8 laut D022: Spitze 71, Nutzer 45, Tippquoten aus abgegebenen Tipps durch mögliche Spiele.
const players = [
  { id: "MS", points: 71, pickRate: 1 },
  { id: "LM", points: 69, pickRate: 0.95 },
  { id: "DH", points: 68, pickRate: 0.95 },
  { id: "CZ", points: 51, pickRate: 0.8 },
  { id: "JA", points: 45, pickRate: 1 },
];

describe("mulberry32", () => {
  it("reproduzierbar und gleichmässig in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 10_000 }, () => a());
    expect(Array.from({ length: 10_000 }, () => b())).toEqual(xs);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
    expect(mulberry32(43)()).not.toBe(xs[0]);
  });
});

describe("simulateFirstPlace", () => {
  it("gleicher Seed, gleiches Ergebnis, Ausgabe je k", () => {
    const input = { players, me: "JA", remainingWeeks: 10, seed: 7, runs: 2000 };
    const a = simulateFirstPlace(input);
    expect(simulateFirstPlace(input)).toEqual(a);
    expect(a.runs).toBe(2000);
    expect(a.results.map((r) => r.k)).toEqual([0, 1, 2, 3]);
    for (const r of a.results) {
      expect(r.winChance).toBeGreaterThanOrEqual(0);
      expect(r.winChance).toBeLessThanOrEqual(1);
    }
  });

  it("26 Punkte Rückstand: ohne Abweichung praktisch chancenlos, Abweichungen kosten im Mittel Punkte", () => {
    const { results } = simulateFirstPlace({ players, me: "JA", remainingWeeks: 10, seed: 1, runs: 3000 });
    expect(results[0]!.winChance).toBeLessThan(0.01);
    expect(results[3]!.meanPoints).toBeLessThan(results[0]!.meanPoints);
  });

  it("knapper Rückstand gegen schwache Tipper: Favoriten genügen, Chance hoch", () => {
    const close = [
      { id: "A", points: 50, pickRate: 0.7 },
      { id: "JA", points: 49, pickRate: 1 },
    ];
    const { results } = simulateFirstPlace({ players: close, me: "JA", remainingWeeks: 5, seed: 3, runs: 3000 });
    expect(results[0]!.winChance).toBeGreaterThan(0.95);
    expect(results[0]!.winChance).toBeGreaterThanOrEqual(results[3]!.winChance);
  });

  it("ohne Restwochen entscheidet der Stand, Gleichstand zählt anteilig", () => {
    const lead = simulateFirstPlace({ players: [{ id: "A", points: 10 }, { id: "JA", points: 12 }], me: "JA", remainingWeeks: 0 });
    expect(lead.results.every((r) => r.winChance === 1 && r.meanPoints === 12)).toBe(true);
    const tie = simulateFirstPlace({ players: [{ id: "A", points: 12 }, { id: "B", points: 12 }, { id: "JA", points: 12 }], me: "JA", remainingWeeks: 0 });
    expect(tie.results[0]!.winChance).toBeCloseTo(1 / 3, 4);
  });

  it("bekannte Wochen: sichere Favoriten bringen jedem den Punkt, Abweichung kostet ihn sicher", () => {
    const known = [[1, 1, 1]];
    const out = simulateFirstPlace({
      players: [{ id: "A", points: 10 }, { id: "JA", points: 10 }],
      me: "JA",
      remainingWeeks: 1,
      knownWeeks: known,
      ks: [0, 1, 5],
      runs: 200,
    });
    expect(out.results).toEqual([
      { k: 0, winChance: 0.5, meanPoints: 13 },
      { k: 1, winChance: 0, meanPoints: 12 },
      { k: 5, winChance: 0, meanPoints: 10 },
    ]);
  });

  it("Abweichung geht auf das knappste Spiel", () => {
    // Ein sicheres Spiel und ein Münzwurf: mit k = 1 verliert der Spieler nie den sicheren Punkt.
    const out = simulateFirstPlace({
      players: [{ id: "A", points: 0 }, { id: "JA", points: 0 }],
      me: "JA",
      remainingWeeks: 1,
      knownWeeks: [[1, 0.5]],
      ks: [1],
      runs: 4000,
      seed: 9,
    });
    expect(out.results[0]!.meanPoints).toBeGreaterThan(1.4);
    expect(out.results[0]!.meanPoints).toBeLessThan(1.6);
  });

  it("unbekanntes Kürzel wirft, Tippquote begrenzt", () => {
    expect(() => simulateFirstPlace({ players, me: "XX", remainingWeeks: 1 })).toThrow(/XX/);
    expect(observedPickRate(73, 117)).toBeCloseTo(0.624, 3);
    expect(observedPickRate(5, 0)).toBe(1);
    expect(observedPickRate(130, 117)).toBe(1);
    expect(DEFAULT_PROB_POOL.every((p) => p >= 0.5 && p < 1)).toBe(true);
  });

  it("5000 Durchläufe der Restsaison unter 300 ms", () => {
    const pool = Array.from({ length: 120 }, (_, i) => 0.5 + (i % 45) / 100);
    const t0 = performance.now();
    simulateFirstPlace({ players, me: "JA", remainingWeeks: 10, probPool: pool, gamesPerWeek: 16, runs: 5000, seed: 11 });
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
