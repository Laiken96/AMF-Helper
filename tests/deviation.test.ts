import { describe, expect, it } from "vitest";
import { CANDIDATE_MAX_UNDERDOG_SHARE, deviationCandidate, deviationCandidates, favoriteOf } from "../src/core/deviation";
import type { Game } from "../src/core/schema";
import type { GameTip } from "../src/core/tips-schema";

const NOW = "2026-11-05T12:00:00Z";

const game = (id: string, extra: Partial<Game> = {}): Game => ({
  id,
  season: 2026,
  seasonType: 2,
  week: 9,
  kickoffUtc: "2026-11-08T14:30:00Z",
  homeId: `h${id}`,
  awayId: `a${id}`,
  status: "scheduled",
  statusDetail: "",
  homeScore: null,
  awayScore: null,
  venue: null,
  neutralSite: false,
  ...extra,
});

const tip = (gameId: string, pHome: number | null, extra: Partial<GameTip> = {}): GameTip => {
  const home = pHome !== null && pHome >= 0.5;
  const prob = pHome === null ? null : home ? pHome : 1 - pHome;
  return {
    gameId,
    kickoffUtc: "2026-11-08T14:30:00Z",
    odds: null,
    pHome,
    pickTeamId: pHome === null ? null : home ? `h${gameId}` : `a${gameId}`,
    pickProb: prob,
    level: prob === null ? "offen" : prob >= 0.75 ? "klar" : prob >= 0.6 ? "favorit" : "unklar",
    deviation: false,
    firstPickTeamId: null,
    changedSinceFirst: false,
    locked: false,
    lockedAt: null,
    ...extra,
  };
};

const picks = (id: string, homeShare: number) => ({ homeId: `h${id}`, awayId: `a${id}`, homeShare, awayShare: 1 - homeShare, total: 1000 });

describe("favoriteOf", () => {
  it("Favorit aus pHome, bei 0.5 das Heimteam", () => {
    expect(favoriteOf({ pHome: 0.41 }, game("1"))).toEqual({ favoriteId: "a1", underdogId: "h1", favoriteProb: 0.59 });
    expect(favoriteOf({ pHome: 0.5 }, game("1"))?.favoriteId).toBe("h1");
    expect(favoriteOf({ pHome: null }, game("1"))).toBeNull();
  });
});

describe("Kandidat Abweichung möglich (D052)", () => {
  it("unklar und Aussenseiter selten getippt", () => {
    // CIN @ ATL: ATL Heim mit 41 %, ESPN Tipps 28 % auf ATL
    const c = deviationCandidate(tip("1", 0.41), game("1"), picks("1", 0.28), NOW);
    expect(c).toMatchObject({ favoriteId: "a1", underdogId: "h1", underdogShare: 0.28, withoutPicks: false });
    expect(c!.favoriteProb).toBeCloseTo(0.59, 6);
  });

  it("Grenze 35 Prozent der ESPN Tipps", () => {
    expect(deviationCandidate(tip("1", 0.55), game("1"), picks("1", 1 - CANDIDATE_MAX_UNDERDOG_SHARE), NOW)).not.toBeNull();
    expect(deviationCandidate(tip("1", 0.55), game("1"), picks("1", 0.64), NOW)).toBeNull();
  });

  it("ohne Tippverteilung reicht die Lage unklar, mit Hinweis", () => {
    expect(deviationCandidate(tip("1", 0.55), game("1"), null, NOW)).toMatchObject({ underdogShare: null, withoutPicks: true });
    // Tippverteilung zu anderen Teams gilt als fehlend
    const other = { ...picks("1", 0.9), homeId: "x" };
    expect(deviationCandidate(tip("1", 0.55), game("1"), other, NOW)).toMatchObject({ withoutPicks: true });
  });

  it("kein Kandidat ab 60 Prozent, ohne Quote, gesperrt, ab Kickoff oder nicht geplant", () => {
    expect(deviationCandidate(tip("1", 0.6), game("1"), null, NOW)).toBeNull();
    expect(deviationCandidate(tip("1", 0.3), game("1"), null, NOW)).toBeNull();
    expect(deviationCandidate(tip("1", null), game("1"), null, NOW)).toBeNull();
    expect(deviationCandidate(tip("1", 0.55, { locked: true }), game("1"), null, NOW)).toBeNull();
    expect(deviationCandidate(tip("1", 0.55), game("1"), null, "2026-11-08T14:30:00Z")).toBeNull();
    expect(deviationCandidate(tip("1", 0.55), game("1", { status: "postponed" }), null, NOW)).toBeNull();
    expect(deviationCandidate(tip("1", 0.55, { level: "nicht_erfasst" }), game("1"), null, NOW)).toBeNull();
  });

  it("die eigene Wahl ändert den Kandidaten nicht, massgebend ist pHome", () => {
    const chosen = { ...tip("1", 0.55), pickTeamId: "a1", pickProb: 0.45, deviation: true };
    expect(deviationCandidate(chosen, game("1"), null, NOW)).toMatchObject({ favoriteId: "h1", underdogId: "a1" });
  });

  it("ganze Woche nach gameId", () => {
    const games = [game("1"), game("2"), game("3")];
    const tips = { tips: [tip("1", 0.55), tip("2", 0.8), tip("3", 0.45), tip("9", 0.5)] };
    const pk = { games: [{ gameId: "3", ...picks("3", 0.5) }] };
    const out = deviationCandidates(tips, games, pk as never, NOW);
    expect([...out.keys()]).toEqual(["1"]);
    expect(out.get("1")!.withoutPicks).toBe(true);
  });
});
