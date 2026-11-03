import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../src/core/schema";
import type { GameTip } from "../src/core/tips-schema";
import {
  gameState,
  kickoffCountdown,
  kickoffLine,
  outsiderChoice,
  resultText,
  shownResult,
  teamLines,
  teamRecords,
  tvText,
  winnerSide,
} from "../src/app/game-view";
import { cachedGameSummary, clearGameSummaryCache, loadGameSummary, parseLiveScoreboard } from "../src/app/live";
import { parseLiveSummary } from "../src/app/live-summary";

// Echte ESPN Antworten: Summary JAX@BAL vor dem Spiel (Week 9), Scoreboard Week 8 mit beendeten Spielen
const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const read = (name: string) => JSON.parse(raw(name)) as unknown;

function game(extra: Partial<Game> = {}): Game {
  return {
    id: "401873038",
    season: 2026,
    seasonType: 2,
    week: 9,
    kickoffUtc: "2026-11-08T14:30:00Z",
    homeId: "1",
    awayId: "4",
    status: "scheduled",
    statusDetail: "11/8 - 9:30 AM EST",
    homeScore: null,
    awayScore: null,
    venue: "Santiago Bernabéu",
    neutralSite: true,
    ...extra,
  };
}

function tip(extra: Partial<GameTip> = {}): GameTip {
  return {
    gameId: "401873038",
    kickoffUtc: "2026-11-08T14:30:00Z",
    odds: { provider: "DraftKings", spreadHome: 3, overUnder: 52.5, fetchedAt: "2026-11-02T23:47:16Z" },
    pHome: 0.4121,
    pickTeamId: "4",
    pickProb: 0.5879,
    level: "unklar",
    deviation: false,
    firstPickTeamId: "4",
    firstOdds: null,
    changedSinceFirst: false,
    locked: false,
    lockedAt: null,
    ...extra,
  } as GameTip;
}

const NOW = Date.parse("2026-11-03T20:00:00Z");

describe("Kopf vor dem Spiel", () => {
  it("Kickoff in Schweizer Zeit mit Uhr", () => {
    expect(kickoffLine("2026-11-08T14:30:00Z")).toBe("So 08.11. · 15:30 Uhr");
  });

  it("Countdown bis Kickoff, danach vorbei", () => {
    expect(kickoffCountdown("2026-11-08T14:30:00Z", NOW)).toBe("Kickoff in 4 Tg 18 h");
    expect(kickoffCountdown("2026-11-03T19:00:00Z", NOW)).toBe("Kickoff vorbei");
  });

  it("Bilanz und TV aus der echten Summary vor dem Spiel", () => {
    const s = parseLiveSummary(read("espn-summary-2026-w9-401873037.json"));
    // JAX (30) auswärts bei BAL (33)
    expect(teamRecords(s, null, "30", "33")).toEqual({ away: "5-2", home: "4-4" });
    expect(tvText(s, null)).toBe("Prime Video");
    expect(teamLines(s, null, "30", "33")).toEqual({ away: [], home: [] });
  });

  it("ohne Summary Bilanz aus dem Scoreboard, ohne beides null", () => {
    const live = parseLiveScoreboard(read("espn-scoreboard-2026-w9.json")).get("401873038");
    expect(teamRecords(null, live, "4", "1")).toEqual({ away: "5-2", home: "3-5" });
    expect(tvText(null, live)).toBe("NFL Net");
    expect(teamRecords(null, null, "4", "1")).toEqual({ away: null, home: null });
    expect(tvText(null, null)).toBeNull();
  });
});

describe("Ergebnis nach dem Spiel", () => {
  const board = parseLiveScoreboard(read("espn-scoreboard-2026-w8.json"));

  it("Sieger aus dem Stand", () => {
    expect(winnerSide(34, 17)).toBe("away");
    expect(winnerSide(17, 34)).toBe("home");
    expect(winnerSide(20, 20)).toBe("tie");
    expect(winnerSide(null, 3)).toBeNull();
  });

  it("beendetes Spiel aus Live Daten zählt vor der Wochendatei", () => {
    // TEN @ CIN 36 : 43 nach Verlängerung, Wochendatei noch geplant
    const lg = board.get("401873031")!;
    const g = game({ id: "401873031", homeId: "4", awayId: "10", kickoffUtc: "2026-11-01T18:00:00Z" });
    const st = gameState(g, lg);
    expect(st.status).toBe("final");
    expect(st.showScore).toBe(true);
    expect([st.awayScore, st.homeScore]).toEqual([36, 43]);
    expect(st.statusText).toBe("Beendet n. V.");
    const t = tip({ gameId: g.id, kickoffUtc: g.kickoffUtc, pickTeamId: "4", locked: true });
    expect(shownResult(t, g, true, st.awayScore, st.homeScore, NOW)).toBe("richtig");
    expect(shownResult({ ...t, pickTeamId: "10" }, g, true, st.awayScore, st.homeScore, NOW)).toBe("falsch");
    expect(teamLines(null, lg, "10", "4").home).toHaveLength(5);
  });

  it("Wochendatei final, Unentschieden und kein Tipp", () => {
    const g = game({ status: "final", awayScore: 20, homeScore: 20, kickoffUtc: "2026-11-01T18:00:00Z" });
    const t = tip({ kickoffUtc: g.kickoffUtc, locked: true });
    expect(shownResult(t, g, true, 20, 20, NOW)).toBe("unentschieden");
    expect(shownResult(undefined, g, true, 20, 20, NOW)).toBeNull();
    expect(shownResult(tip({ level: "nicht_erfasst", pickTeamId: null }), g, true, 20, 20, NOW)).toBeNull();
  });

  it("vor dem Ende kein Ergebnis", () => {
    expect(shownResult(tip(), game(), false, null, null, NOW)).toBeNull();
  });

  it("Text mit Symbolbedeutung", () => {
    expect(resultText("richtig", "CIN")).toBe("Dein Tipp CIN richtig");
    expect(resultText("falsch", "SEA")).toBe("Dein Tipp SEA falsch");
    expect(resultText("unentschieden", "SEA")).toBe("Unentschieden, zählt als falsch");
    expect(resultText("ungewertet", null)).toBe("Spiel ungewertet");
  });
});

describe("Knopf Aussenseiter tippen (D052)", () => {
  it("Favorit aus pHome, Aussenseiter ist das andere Team", () => {
    expect(outsiderChoice(tip(), game(), NOW)).toEqual({ favoriteId: "4", underdogId: "1", locked: false });
  });

  it("auch bei eigener Wahl bleibt der Favorit aus pHome", () => {
    const own = tip({ pickTeamId: "1", pickProb: 0.4121, deviation: true });
    expect(outsiderChoice(own, game(), NOW)).toEqual({ favoriteId: "4", underdogId: "1", locked: false });
  });

  it("nach Kickoff gesperrt, ohne Quote kein Knopf", () => {
    expect(outsiderChoice(tip(), game(), Date.parse("2026-11-08T15:00:00Z"))?.locked).toBe(true);
    expect(outsiderChoice(tip({ pHome: null }), game(), NOW)).toBeNull();
    expect(outsiderChoice(tip({ level: "offen", pickTeamId: null }), game(), NOW)).toBeNull();
    expect(outsiderChoice(undefined, game(), NOW)).toBeNull();
  });
});

describe("Summary einmal laden", () => {
  beforeEach(() => clearGameSummaryCache());

  const ok = () => new Response(raw("espn-summary-2026-w9-401873037.json"), { status: 200 });

  it("ein Abruf, danach aus dem Speicher, gleichzeitige Aufrufe teilen ihn", async () => {
    const f = vi.fn(async () => ok());
    const [a, b] = await Promise.all([loadGameSummary("401873037", "pre", f), loadGameSummary("401873037", "pre", f)]);
    expect(a).toBe(b);
    expect(f).toHaveBeenCalledTimes(1);
    expect(await loadGameSummary("401873037", "pre", f)).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(cachedGameSummary("401873037", "pre")?.info.tv).toEqual(["Prime Video"]);
    // Nach dem Spiel eine eigene Ladung, der Stand vor dem Spiel gilt dort nicht
    expect(cachedGameSummary("401873037", "post")).toBeUndefined();
  });

  it("Fehler werden nicht gespeichert, der nächste Aufruf versucht es neu", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    await expect(loadGameSummary("401873037", "post", f)).rejects.toThrow("HTTP 503");
    const g = vi.fn(async () => ok());
    await expect(loadGameSummary("401873037", "post", g)).resolves.toBeTruthy();
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("ruft die Summary des Spiels ohne Browser Cache ab", async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ok());
    await loadGameSummary("401873037", "pre", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain("event=401873037");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
