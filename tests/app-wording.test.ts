import { describe, expect, it } from "vitest";
import { beforeAppStart } from "../src/app/data";
import {
  SLOT_SHORT,
  deviationReason,
  formatCountdown,
  formatStand,
  friendlyLoadError,
  scoreAria,
  scoreText,
  spreadText,
  statusWord,
  tippschlussText,
} from "../src/app/wording";
import type { WeeksIndex } from "../src/core/extra-schema";

const odds = (spreadHome: number) => ({ provider: "DraftKings", spreadHome, overUnder: 44.5, fetchedAt: "2026-11-02T21:47:17Z" });

describe("Wording D050", () => {
  it("Datenstand einheitlich in Schweizer Zeit", () => {
    expect(formatStand("2026-11-02T21:47:00Z")).toBe("Stand Mo 02.11. 22:47");
    expect(formatStand("kein Datum")).toBe("Stand unbekannt");
  });

  it("ESPN Status auf Deutsch", () => {
    expect(statusWord("Final")).toBe("Beendet");
    expect(statusWord("Final/OT")).toBe("Beendet n. V.");
    expect(statusWord("Final/2OT")).toBe("Beendet n. V.");
    expect(statusWord("Halftime")).toBe("Halbzeit");
    expect(statusWord("End of 3rd Quarter")).toBe("Ende Q3");
    expect(statusWord("Q3 4:12")).toBe("Q3 4:12");
    expect(statusWord(null)).toBe("");
  });

  it("Countdown mit Tg und immer Tippschluss in", () => {
    expect(formatCountdown((3 * 24 * 60 + 3 * 60) * 60_000)).toBe("3 Tg 3 h");
    expect(formatCountdown(59_000)).toBe("1 min");
    expect(tippschlussText(2 * 3600_000 + 5 * 60_000)).toBe("Tippschluss in 2 h 5 min");
  });

  it("Tiebreaker mit TNF und MNF, Resultat mit Leerzeichen", () => {
    expect(SLOT_SHORT).toEqual({ thursday: "TNF", monday: "MNF" });
    expect(scoreText(22, 25)).toBe("22 : 25");
    expect(scoreAria(22, 25)).toBe("Tipp 22 zu 25");
  });

  it("Linie aus Sicht des Favoriten", () => {
    expect(spreadText(odds(3), "CIN", "ATL")).toBe("Linie ATL −3");
    expect(spreadText(odds(-2.5), "NO", "CLE")).toBe("Linie NO −2.5");
    expect(spreadText(odds(0), "NO", "CLE")).toBe("Linie ausgeglichen");
    expect(spreadText(null, "NO", "CLE")).toBeNull();
  });

  it("Abweichung begründet mit Grundtipp, Linie und Rückstand", () => {
    expect(
      deviationReason({ pickAbbr: "ATL", pickProb: 0.41, baseAbbr: "CIN", baseProb: 0.59, spread: "Linie CIN −3", maxDeviations: 2, gap: 26 }),
    ).toBe("Grundtipp CIN 59 %, Linie CIN −3. Bewusster Aussenseitertipp ATL 41 %, erlaubt sind diese Woche 2 Abweichungen wegen 26 Punkten Rückstand auf Platz 1.");
    expect(
      deviationReason({ pickAbbr: "ATL", pickProb: null, baseAbbr: null, baseProb: null, spread: null, maxDeviations: 1, gap: 1 }),
    ).toBe("Favorit laut Quote. Bewusster Aussenseitertipp ATL, erlaubt ist diese Woche 1 Abweichung wegen 1 Punkt Rückstand auf Platz 1.");
  });

  it("Ladefehler ohne Dateinamen im Haupttext", () => {
    expect(friendlyLoadError("Zeitüberschreitung beim Laden von current.json. Bitte …")).not.toMatch(/json/);
    expect(friendlyLoadError("Datei weeks/2026-2-08.json konnte nicht geladen werden (HTTP 404).")).toBe("Ein Teil der Daten fehlt gerade.");
  });

  it("Woche vor App Start nur mit Index", () => {
    const index = {
      schemaVersion: 1,
      updatedAt: "2026-11-02T20:00:00Z",
      weeks: [{ season: 2026, seasonType: 2, week: 8, weekFile: "weeks/2026-2-08.json", tipsFile: null, reviewFile: null, opinionFile: null }],
    } as WeeksIndex;
    expect(beforeAppStart(index, { season: 2026, seasonType: 2, week: 7 })).toBe(true);
    expect(beforeAppStart(index, { season: 2026, seasonType: 2, week: 8 })).toBe(false);
    expect(beforeAppStart(null, { season: 2026, seasonType: 2, week: 7 })).toBe(false);
  });
});
