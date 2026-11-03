import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScoreboard } from "../src/core/espn";
import { TeamsFileSchema, type Team } from "../src/core/schema";
import { TipsFileSchema, type TipsFile } from "../src/core/tips-schema";
import { buildTipsFile } from "../src/core/tips";
import { groupBySlot } from "../src/core/time";
import type { InjuriesFile } from "../src/core/injuries";
import type { ReviewFile } from "../src/core/review-schema";
import {
  BODY_MAX,
  EMPTY_PUSH_LOG,
  TITLE_MAX,
  appendLog,
  dueMessages,
  fitParts,
  inSlotWindow,
  lineMoveItem,
  reviewReadyMessage,
  shortName,
  slotMessages,
  statusCode,
  tipsReadyMessage,
} from "../src/core/push-messages";

const w9 = parseScoreboard(JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w9.json", import.meta.url), "utf8")), {
  fetchedAt: "2026-11-02T00:00:00Z",
});
if (!w9.ok) throw new Error(w9.error);
const games = w9.week.games;
const teamsFile = TeamsFileSchema.parse(JSON.parse(readFileSync(new URL("./fixtures/teams.json", import.meta.url), "utf8")));
const teams = new Map<string, Team>(teamsFile.teams.map((t) => [t.id, t]));
const tipsW9 = TipsFileSchema.parse(JSON.parse(readFileSync(new URL("./fixtures/tips-2026-2-09.json", import.meta.url), "utf8")));

const TNF = "2026-11-06T01:15:00Z";
const minus = (iso: string, min: number) => new Date(Date.parse(iso) - min * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

function withChangedTnf(): TipsFile {
  return {
    ...tipsW9,
    tips: tipsW9.tips.map((t) =>
      t.gameId === "401873037" ? { ...t, firstPickTeamId: "30", pickTeamId: "33", changedSinceFirst: true } : t,
    ),
  };
}

const injuries = (changes: InjuriesFile["changes"], withBaseline = true): InjuriesFile => ({
  schemaVersion: 1,
  season: 2026,
  seasonType: 2,
  week: 9,
  baselineFrom: "2026-11-05T05:00:00Z",
  baseline: withBaseline ? { takenAt: "2026-11-05T05:00:00Z", games: [] } : null,
  current: { takenAt: "2026-11-06T00:30:00Z", games: [] },
  changes,
});

const qToO = {
  gameId: "401873037",
  athleteId: "3916387",
  name: "Lamar Jackson",
  pos: "QB",
  teamAbbr: "BAL",
  kind: "wechsel" as const,
  from: "Questionable",
  to: "Out",
};

describe("Texte", () => {
  it("Kürzel für Status und Namen", () => {
    expect(statusCode("Out")).toBe("O");
    expect(statusCode("Questionable")).toBe("Q");
    expect(statusCode("Injured Reserve")).toBe("IR");
    expect(statusCode(null)).toBe("fit");
    expect(shortName("Lamar Jackson")).toBe("L.Jackson");
    expect(shortName("Luther Burden III")).toBe("L.Burden III");
  });

  it("kürzt Listen mit +N", () => {
    expect(fitParts("A. ", ["bb", "cc", "dd"], 9)).toBe("A. bb +2");
    expect(fitParts("A. ", ["bb"], 20)).toBe("A. bb");
  });
});

describe("Slot Fenster", () => {
  it("Grenzen 2 und 60 Minuten sind fällig, knapp ausserhalb nicht", () => {
    expect(inSlotWindow(TNF, minus(TNF, 2))).toBe(true);
    expect(inSlotWindow(TNF, minus(TNF, 60))).toBe(true);
    expect(inSlotWindow(TNF, minus(TNF, 1.9))).toBe(false);
    expect(inSlotWindow(TNF, minus(TNF, 60.1))).toBe(false);
  });

  it("Slot Meldung nur im Fenster", () => {
    const at = (min: number) => slotMessages({ games, tips: tipsW9, injuries: null, teams, now: minus(TNF, min) });
    expect(at(61)).toEqual([]);
    expect(at(60)).toHaveLength(1);
    expect(at(30)[0]?.payload.title).toBe("Tippschluss in 30 min");
    expect(at(2)[0]?.payload.title).toBe("Tippschluss in 2 min");
    expect(at(1)).toEqual([]);
  });

  it("TTL bis zum Kickoff, mindestens 60 Sekunden", () => {
    const at = (min: number) => slotMessages({ games, tips: tipsW9, injuries: null, teams, now: minus(TNF, min) })[0]?.ttlSeconds;
    expect(at(42)).toBe(42 * 60);
    expect(at(2)).toBe(120);
    expect(tipsReadyMessage(tipsW9, games, teams)?.ttlSeconds).toBe(6 * 3600);
  });

  it("Active zählt als fit", () => {
    expect(statusCode("Active")).toBe("fit");
  });

  it("ohne Änderung steht Keine Änderung im Text", () => {
    const [m] = slotMessages({ games, tips: tipsW9, injuries: injuries([]), teams, now: minus(TNF, 42) });
    expect(m?.key).toBe("slot:2026-11-06T02:15+01:00");
    expect(m?.payload).toMatchObject({ title: "Tippschluss in 42 min", body: "JAX@BAL. Keine Änderung", url: "#tipps" });
  });

  it("Tippänderung und Ausfall im Text", () => {
    const [m] = slotMessages({ games, tips: withChangedTnf(), injuries: injuries([qToO]), teams, now: minus(TNF, 30) });
    expect(m?.payload.body).toBe("JAX@BAL. Tipp JAX>BAL, BAL L.Jackson QB Q>O");
  });

  it("ohne Grundstand keine Ausfälle in der Meldung", () => {
    const [m] = slotMessages({ games, tips: tipsW9, injuries: injuries([qToO], false), teams, now: minus(TNF, 30) });
    expect(m?.payload.body).toBe("JAX@BAL. Keine Änderung");
  });

  it("lange Listen bleiben unter 180 Zeichen", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...qToO, athleteId: String(i), name: `Spieler Nummer${i}` }));
    const [m] = slotMessages({ games, tips: tipsW9, injuries: injuries(many), teams, now: minus(TNF, 30) });
    expect(m!.payload.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(m!.payload.body).toMatch(/ \+\d+$/);
  });
});

describe("Tippliste bereit", () => {
  it("Anzahl Spiele, Vorschlag Favorit und beide Tiebreaker (D052)", () => {
    const m = tipsReadyMessage(tipsW9, games, teams);
    expect(m?.key).toBe("tips-ready:2026-2-9");
    expect(m?.payload.title).toBe("Tippliste W9 bereit");
    expect(m?.payload.body).toMatch(/^15 Spiele, Vorschlag Favorit\. TB TNF JAX@BAL 26:18, MNF \w+@\w+ 22:25$/);
    expect(m?.payload.body).not.toContain("Abw");
    expect(m!.payload.title.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it("nennt nur offene Spiele, gesperrte zählen nicht", () => {
    const afterTnf = "2026-11-06T02:00:00Z";
    const m = tipsReadyMessage(tipsW9, games, teams, afterTnf);
    expect(m?.payload.body).toMatch(/^14 Spiele, /);
    expect(m?.payload.body).not.toContain("TNF");
    expect(m?.payload.body).toMatch(/TB MNF \w+@\w+ 22:25$/);
    const lockedTnf = { ...tipsW9, tips: tipsW9.tips.map((t) => (t.gameId === "401873037" ? { ...t, locked: true } : t)) };
    expect(tipsReadyMessage(lockedTnf, games, teams)?.payload.body).toMatch(/^14 Spiele, /);
  });

  it("alle Spiele gesperrt: keine Meldung", () => {
    const allLocked = { ...tipsW9, tips: tipsW9.tips.map((t) => ({ ...t, locked: true })) };
    expect(tipsReadyMessage(allLocked, games, teams)).toBeNull();
    expect(tipsReadyMessage(tipsW9, games, teams, "2026-11-20T00:00:00Z")).toBeNull();
  });

  it("ohne Quote keine Meldung", () => {
    const noOdds = { ...tipsW9, tips: tipsW9.tips.map((t) => ({ ...t, odds: null })) };
    expect(tipsReadyMessage(noOdds, games, teams)).toBeNull();
  });
});

describe("keine doppelte Meldung", () => {
  it("bereits geloggte Schlüssel sind nicht mehr fällig", () => {
    const now = minus(TNF, 30);
    const first = dueMessages({ games, tips: tipsW9, injuries: null, teams, now, log: EMPTY_PUSH_LOG });
    expect(first.map((m) => m.key)).toEqual(["tips-ready:2026-2-9", "slot:2026-11-06T02:15+01:00"]);
    const log = appendLog(EMPTY_PUSH_LOG, first.map((message) => ({ message, sentAt: now })));
    expect(dueMessages({ games, tips: tipsW9, injuries: null, teams, now: minus(TNF, 20), log })).toEqual([]);
  });
});

describe("Bilanz bereit", () => {
  const base: ReviewFile = {
    schemaVersion: 1,
    season: 2026,
    seasonType: 2,
    week: 8,
    updatedAt: "2026-11-03T10:00:00Z",
    complete: true,
    games: [],
    points: 9,
    tipped: 13,
    deviationNet: 1,
    tiebreakers: [
      { gameId: "a", slot: "thursday", predictedHome: 24, predictedAway: 20, actualHome: 27, actualAway: 19, diff: 4 },
      { gameId: "b", slot: "monday", predictedHome: 25, predictedAway: 22, actualHome: 17, actualAway: 23, diff: 9 },
    ],
  };
  const now = "2026-11-03T10:00:00Z";

  it("Text mit Punkten, Abweichungen netto, Tiebreaker und Hinweis", () => {
    const m = reviewReadyMessage(base)!;
    expect(m.key).toBe("review-ready:2026-2-8");
    expect(m.payload).toEqual({
      title: "Bilanz W8 bereit",
      body: "App Punkte 9 von 13, Abweichungen netto +1, Tiebreaker Abweichung TNF 4, MNF 9. Rangliste melden",
      url: "#bilanz",
      tag: "review-ready-2026-2-8",
    });
    expect(m.payload.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(m.payload.body.length).toBeLessThanOrEqual(BODY_MAX);
  });

  it("negatives Netto und ohne Tiebreaker", () => {
    const m = reviewReadyMessage({ ...base, deviationNet: -2, tiebreakers: [] })!;
    expect(m.payload.body).toBe("App Punkte 9 von 13, Abweichungen netto -2, Tiebreaker Abweichung keine. Rangliste melden");
  });

  it("nicht komplette Woche ist nicht fällig", () => {
    expect(reviewReadyMessage({ ...base, complete: false })).toBeNull();
    expect(dueMessages({ games: [], tips: null, injuries: null, teams, now, log: EMPTY_PUSH_LOG, reviews: [{ ...base, complete: false }] })).toEqual([]);
  });

  it("einmal pro Woche, danach im push-log", () => {
    const first = dueMessages({ games: [], tips: null, injuries: null, teams, now, log: EMPTY_PUSH_LOG, reviews: [base] });
    expect(first.map((m) => m.key)).toEqual(["review-ready:2026-2-8"]);
    const log = appendLog(EMPTY_PUSH_LOG, [{ message: first[0]!, sentAt: now }]);
    expect(dueMessages({ games: [], tips: null, injuries: null, teams, now, log, reviews: [base] })).toEqual([]);
  });

  it("nur die neueste komplette Woche, Zwischenstand davor wird übersprungen", () => {
    const w9 = { ...base, week: 9, complete: false };
    const w7 = { ...base, week: 7 };
    const due = dueMessages({ games: [], tips: null, injuries: null, teams, now, log: EMPTY_PUSH_LOG, reviews: [w9, base, w7] });
    expect(due.map((m) => m.key)).toEqual(["review-ready:2026-2-8"]);
  });
});

describe("Linienbewegung (D050)", () => {
  const tnfGame = games.find((g) => g.id === "401873037")!;
  const tnfTip = tipsW9.tips.find((t) => t.gameId === "401873037")!;
  const odds = (spreadHome: number) => ({ ...tnfTip.odds!, spreadHome });
  const withLine = (first: number, now: number, changed = false): TipsFile => ({
    ...tipsW9,
    tips: tipsW9.tips.map((t) =>
      t.gameId === "401873037"
        ? { ...t, firstOdds: odds(first), odds: odds(now), ...(changed ? { firstPickTeamId: "30", pickTeamId: "33", changedSinceFirst: true } : {}) }
        : t,
    ),
  });

  it("Bewegung ab 2.5 Punkten aus Sicht des Favoriten", () => {
    // spreadHome +3 heisst JAX (Gast) -3
    expect(lineMoveItem({ firstOdds: odds(3), odds: odds(8.5) }, tnfGame, teams)).toBe("Linie JAX -3 > -8.5");
    expect(lineMoveItem({ firstOdds: odds(-3), odds: odds(-0.5) }, tnfGame, teams)).toBe("Linie BAL -3 > -0.5");
  });

  it("unter 2.5 Punkten ohne Favoritenwechsel kein Zusatz", () => {
    expect(lineMoveItem({ firstOdds: odds(3), odds: odds(5) }, tnfGame, teams)).toBeNull();
    expect(lineMoveItem({ firstOdds: odds(-1), odds: odds(0) }, tnfGame, teams)).toBeNull();
  });

  it("Favoritenwechsel auch bei kleiner Bewegung", () => {
    expect(lineMoveItem({ firstOdds: odds(-1), odds: odds(1) }, tnfGame, teams)).toBe("Linie JAX +1 > -1");
  });

  it("ohne erste Quote (Version 1) oder ohne Quote kein Zusatz", () => {
    expect(lineMoveItem({ odds: odds(8.5) }, tnfGame, teams)).toBeNull();
    expect(lineMoveItem({ firstOdds: odds(3), odds: null }, tnfGame, teams)).toBeNull();
  });

  it("Slot Meldung mit Tippänderung, Linie und Ausfall", () => {
    const [m] = slotMessages({ games, tips: withLine(-3, 1, true), injuries: injuries([qToO]), teams, now: minus(TNF, 30) });
    expect(m?.payload.body).toBe("JAX@BAL. Tipp JAX>BAL, Linie JAX +3 > -1, BAL L.Jackson QB Q>O");
  });

  it("Slot Meldung nur mit Linie statt Keine Änderung", () => {
    const [m] = slotMessages({ games, tips: withLine(3, 8.5), injuries: injuries([]), teams, now: minus(TNF, 30) });
    expect(m?.payload.body).toBe("JAX@BAL. Linie JAX -3 > -8.5");
  });
});

describe("Verwerfen alter Abweichungen (D052)", () => {
  // Job Lauf auf der Datei von Week 9 mit zwei eingefrorenen Abweichungen, Quoten wie in der Datei
  const odds = Object.fromEntries(tipsW9.tips.map((t) => [t.gameId, t.odds]));
  const standings = { schemaVersion: 1 as const, asOfWeek: 8, updatedAt: "2026-11-02T03:00:00Z", me: "JA", players: [{ id: "JA", points: 45 }, { id: "MS", points: 71 }] };
  const reverted = buildTipsFile({ week: w9.week, odds, standings, existing: tipsW9, now: "2026-11-03T12:00:00Z" });

  it("keine Tippänderung in den Slot Meldungen, auch nicht für die betroffenen Spiele", () => {
    expect(tipsW9.tips.filter((t) => t.changedSinceFirst).length).toBeGreaterThan(0);
    expect(reverted.tips.some((t) => t.changedSinceFirst)).toBe(false);
    for (const slot of groupBySlot(games.filter((g) => g.status === "scheduled"))) {
      const msgs = slotMessages({ games, tips: reverted, injuries: null, teams, now: minus(slot.kickoffUtc, 30) });
      for (const m of msgs) expect(m.payload.body).not.toMatch(/Tipp \w+>\w+/);
    }
  });

  it("vor dem Verwerfen hätte jede betroffene Slot Meldung eine Tippänderung genannt", () => {
    const devGames = tipsW9.tips.filter((t) => t.changedSinceFirst).map((t) => t.kickoffUtc);
    const msgs = devGames.flatMap((k) => slotMessages({ games, tips: tipsW9, injuries: null, teams, now: minus(k, 30) }));
    expect(msgs.some((m) => /Tipp \w+>\w+/.test(m.payload.body))).toBe(true);
  });

  it("Tippliste bereit nennt den Vorschlag ohne Abweichung, keine zusätzliche Meldung", () => {
    const due = dueMessages({ games, tips: reverted, injuries: null, teams, now: "2026-11-05T12:00:00Z", log: EMPTY_PUSH_LOG });
    expect(due.map((m) => m.key)).toEqual(["tips-ready:2026-2-9"]);
    expect(due[0]!.payload.body).toMatch(/^15 Spiele, Vorschlag Favorit\./);
  });
});
