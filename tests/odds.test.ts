import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeOdds, parseOdds, parseScoreboard } from "../src/core/espn";

const T = "2026-11-02T03:00:00Z";
const w9 = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w9.json", import.meta.url), "utf8"));

const raw = (o: Record<string, unknown>) => ({ provider: { name: "DraftKings" }, overUnder: 45.5, ...o });

describe("normalizeOdds", () => {
  it("Auswärtsfavorit mit positivem ESPN Spread (JAX @ BAL)", () => {
    const o = raw({ spread: 8.5, details: "JAX -8.5", homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true } });
    expect(normalizeOdds(o, "BAL", "JAX", T)).toEqual({ provider: "DraftKings", spreadHome: 8.5, overUnder: 45.5, fetchedAt: T });
  });
  it("Heimfavorit mit negativem ESPN Spread (NYJ @ KC)", () => {
    const o = raw({ spread: -10, details: "KC -10", homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } });
    expect(normalizeOdds(o, "KC", "NYJ", T)?.spreadHome).toBe(-10);
  });
  it("Vorzeichen des Spreads wird ignoriert, nur favorite zählt", () => {
    const o = raw({ spread: 3, details: "NO -3", homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } });
    expect(normalizeOdds(o, "NO", "CLE", T)?.spreadHome).toBe(-3);
  });
  it("ohne favorite Flag Ersatz über das Kürzel im details Text", () => {
    expect(normalizeOdds(raw({ spread: 6, details: "DAL -6" }), "IND", "DAL", T)?.spreadHome).toBe(6);
    expect(normalizeOdds(raw({ spread: 6, details: "IND -6" }), "IND", "DAL", T)?.spreadHome).toBe(-6);
    expect(normalizeOdds(raw({ details: "IND -6" }), "IND", "DAL", T)?.spreadHome).toBe(-6);
  });
  it("Pick'em ergibt 0", () => {
    expect(normalizeOdds(raw({ spread: 0, details: "EVEN" }), "A", "B", T)?.spreadHome).toBe(0);
    expect(normalizeOdds(raw({ details: "EVEN" }), "A", "B", T)?.spreadHome).toBe(0);
    expect(Object.is(normalizeOdds(raw({ spread: -0 }), "A", "B", T)?.spreadHome, 0)).toBe(true);
  });
  it("fehlende oder kaputte Quote ergibt null", () => {
    expect(normalizeOdds(undefined, "A", "B", T)).toBeNull();
    expect(normalizeOdds("x", "A", "B", T)).toBeNull();
    expect(normalizeOdds(raw({ spread: "abc" }), "A", "B", T)).toBeNull();
    expect(normalizeOdds(raw({ spread: 3 }), "A", "B", T)).toBeNull(); // Richtung unbekannt
    expect(normalizeOdds(raw({ spread: 3, details: "ZZ -3" }), "A", "B", T)).toBeNull();
  });
  it("fehlendes Over/Under und Anbieter", () => {
    const o = normalizeOdds({ spread: 3, details: "BB -3", overUnder: null }, "AA", "BB", T);
    expect(o).toEqual({ provider: "unbekannt", spreadHome: 3, overUnder: null, fetchedAt: T });
  });
});

describe("parseOdds", () => {
  it("Week 9 Fixture: alle Spiele, zwei ohne Quote", () => {
    const odds = parseOdds(w9, T);
    expect(Object.keys(odds)).toHaveLength(15);
    expect(odds["401873037"]).toMatchObject({ spreadHome: 8.5, overUnder: 43.5 }); // JAX @ BAL
    expect(odds["401873045"]).toMatchObject({ spreadHome: -10, overUnder: 45.5 }); // NYJ @ KC
    expect(odds["401873044"]).toBeNull(); // NYG @ PHI ohne Quote
    expect(Object.values(odds).filter((o) => o === null)).toHaveLength(2);
  });
  it("kaputtes Spiel ergibt null, nicht einen Fehler für die Woche", () => {
    const copy = structuredClone(w9);
    copy.events[0].competitions[0].odds = [{ spread: "kaputt" }];
    copy.events[1].competitions[0].odds = "kaputt";
    const odds = parseOdds(copy, T);
    expect(odds["401873037"]).toBeNull();
    expect(odds["401873038"]).toBeNull();
    expect(odds["401873045"]).not.toBeNull();
  });
  it("wirft nie", () => {
    expect(parseOdds(null, T)).toEqual({});
    expect(parseOdds({ events: "x" }, T)).toEqual({});
    expect(parseOdds({ events: [null, 1, {}] }, T)).toEqual({});
  });
  it("Spielplan Parser bleibt unverändert gültig", () => {
    const r = parseScoreboard(w9, { fetchedAt: T });
    expect(r.ok && r.week.games.length).toBe(15);
  });
});
