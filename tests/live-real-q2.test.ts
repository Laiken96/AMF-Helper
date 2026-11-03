import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLastPlays, parseLiveScoreboard, periodText } from "../src/app/live";
import { parseLiveSummary } from "../src/app/live-summary";

// Echte ESPN Antworten MNF CHI@SEA, 2026-11-03 02:31 UTC, 2. Viertel 1:08, Ball in der Red Zone (R105)
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const ID = "401873036";

describe("Liveticker mit echten Daten im 2. Viertel", () => {
  it("Scoreboard: Stand, Viertel, Red Zone", () => {
    const g = parseLiveScoreboard(read("espn-scoreboard-2026-w8-live-q2.json")).get(ID)!;
    expect(g.state).toBe("in");
    expect(g.period).toBe(2);
    expect(g.homeScore).toBe(3);
    expect(g.awayScore).toBe(13);
    expect(g.redZone).toBe(true);
    expect(periodText(g)).toMatch(/2/);
  });

  it("Summary: Punktspielzüge, Drives, Siegchance", () => {
    const s = parseLiveSummary(read("espn-summary-2026-w8-401873036-live-q2.json"));
    expect(s.scoring.length).toBe(4);
    expect(s.winProb.length).toBeGreaterThan(50);
    expect(s.stats.length).toBeGreaterThan(5);
    expect(s.teams.length).toBe(2);
  });

  it("letzte Spielzüge aus der echten Summary", () => {
    const plays = parseLastPlays(read("espn-summary-2026-w8-401873036-live-q2.json"));
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.length).toBeLessThanOrEqual(10);
  });
});
