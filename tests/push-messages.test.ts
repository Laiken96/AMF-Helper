import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScoreboard } from "../src/core/espn";
import { TeamsFileSchema, type Team } from "../src/core/schema";
import { TipsFileSchema, type TipsFile } from "../src/core/tips-schema";
import type { InjuriesFile } from "../src/core/injuries";
import {
  BODY_MAX,
  EMPTY_PUSH_LOG,
  TITLE_MAX,
  appendLog,
  dueMessages,
  fitParts,
  inSlotWindow,
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
const teamsFile = TeamsFileSchema.parse(JSON.parse(readFileSync(new URL("../data/teams.json", import.meta.url), "utf8")));
const teams = new Map<string, Team>(teamsFile.teams.map((t) => [t.id, t]));
const tipsW9 = TipsFileSchema.parse(JSON.parse(readFileSync(new URL("../data/tips/2026-2-09.json", import.meta.url), "utf8")));

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
  it("Grenzen 15 und 60 Minuten sind fällig, knapp ausserhalb nicht", () => {
    expect(inSlotWindow(TNF, minus(TNF, 15))).toBe(true);
    expect(inSlotWindow(TNF, minus(TNF, 60))).toBe(true);
    expect(inSlotWindow(TNF, minus(TNF, 14.9))).toBe(false);
    expect(inSlotWindow(TNF, minus(TNF, 60.1))).toBe(false);
  });

  it("Slot Meldung nur im Fenster", () => {
    const at = (min: number) => slotMessages({ games, tips: tipsW9, injuries: null, teams, now: minus(TNF, min) });
    expect(at(61)).toEqual([]);
    expect(at(60)).toHaveLength(1);
    expect(at(15)[0]?.payload.title).toBe("Tippschluss in 15 min");
    expect(at(14)).toEqual([]);
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
  it("Anzahl Spiele, Abweichungen und beide Tiebreaker", () => {
    const m = tipsReadyMessage(tipsW9, games, teams);
    expect(m?.key).toBe("tips-ready:2026-2-9");
    expect(m?.payload.title).toBe("Tippliste W9 bereit");
    expect(m?.payload.body).toMatch(/^15 Spiele, 2 Abw: \w+ \w+\. TB TNF JAX@BAL 26:18, MNF \w+@\w+ 22:25$/);
    expect(m!.payload.title.length).toBeLessThanOrEqual(TITLE_MAX);
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
