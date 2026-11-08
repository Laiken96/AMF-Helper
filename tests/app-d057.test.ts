// Funde der Bug Suche 2026-11-08 (D057): Hash ohne feste Woche, Blatt im Verlauf, Häkchen pro Spieler,
// offene Zeilen, Abweichungsmarke, Unentschieden, Ergebnis aus Live Daten, eigene Wahl in Bilanz und Saison.
import { describe, expect, it } from "vitest";
import type { Game } from "../src/core/schema";
import type { GameTip, TipsFile } from "../src/core/tips-schema";
import type { ReviewFile } from "../src/core/review-schema";
import { tipResult } from "../src/core/review";
import { buildSeasonSummary } from "../src/core/season";
import { parseViewArg, shouldRevalidate, viewHash, weekOfPath } from "../src/app/data";
import { RESULT_BADGE, entryPending, levelLabel, reviewResult, shownResult, withLiveFinal } from "../src/app/game-view";
import { closeSheetHash, openSheetHash, replaceHash, sheetEntry, type HashWindow } from "../src/app/hash-nav";
import type { LiveGame } from "../src/app/live";
import {
  applyChoices,
  applyChoicesToReview,
  applySeasonChoices,
  enteredKey,
  legacyEnteredKey,
  readEntered,
  writeEntered,
  type KeyStore,
} from "../src/app/player";
import { contrast, darkLogoUrl, visibleOn } from "../src/app/colors";
import { isPromo } from "../src/app/wording";

const W9 = { season: 2026, seasonType: 2, week: 9 };
const W10 = { season: 2026, seasonType: 2, week: 10 };

function game(extra: Partial<Game> = {}): Game {
  return {
    id: "g1",
    season: 2026,
    seasonType: 2,
    week: 9,
    kickoffUtc: "2026-11-08T18:00:00Z",
    homeId: "H",
    awayId: "A",
    status: "scheduled",
    statusDetail: "",
    homeScore: null,
    awayScore: null,
    venue: null,
    neutralSite: false,
    ...extra,
  };
}

function tip(extra: Partial<GameTip> = {}): GameTip {
  return {
    gameId: "g1",
    kickoffUtc: "2026-11-08T18:00:00Z",
    odds: { provider: "DraftKings", spreadHome: -9, overUnder: 44, fetchedAt: "2026-11-02T23:47:16Z" },
    pHome: 0.78,
    pickTeamId: "H",
    pickProb: 0.78,
    level: "klar",
    deviation: false,
    firstPickTeamId: "H",
    firstOdds: null,
    changedSinceFirst: false,
    locked: false,
    lockedAt: null,
    ...extra,
  } as GameTip;
}

function live(extra: Partial<LiveGame> = {}): LiveGame {
  return {
    id: "g1",
    state: "post",
    status: "final",
    period: 4,
    clock: "0:00",
    detail: "Final",
    homeScore: 17,
    awayScore: 24,
    possessionTeamId: null,
    downDistance: null,
    redZone: false,
    lastPlay: null,
    ...extra,
  } as LiveGame;
}

class MemoryStore implements KeyStore {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe("Hash ohne feste Woche (Fund 3)", () => {
  it("lässt die aktuelle Woche weg, andere Wochen bleiben fest", () => {
    expect(viewHash("tipps", W9, W9, "401")).toBe("#tipps/401");
    expect(viewHash("tipps", W9, W9)).toBe("#tipps");
    expect(viewHash("spiele", W10, W9, "402")).toBe("#spiele/2026-2-10/402");
    expect(viewHash("spiele", W10, null)).toBe("#spiele/2026-2-10");
  });

  it("liest Spiel ohne Woche und alte Links mit Woche", () => {
    expect(parseViewArg("401873037")).toEqual({ week: null, game: "401873037" });
    expect(parseViewArg("2026-2-09/401873037")).toEqual({ week: "2026-2-09", game: "401873037" });
    expect(parseViewArg("2026-2-09")).toEqual({ week: "2026-2-09", game: null });
    expect(parseViewArg(null)).toEqual({ week: null, game: null });
  });
});

describe("Hintergrundprüfung nur relevante Wochen (Fund 13)", () => {
  it("prüft Dateien ohne Woche, die aktuelle und die angezeigte Woche", () => {
    expect(weekOfPath("tips/2026-2-09.json")).toEqual(W9);
    expect(shouldRevalidate("news.json", W9, null)).toBe(true);
    expect(shouldRevalidate("weeks/2026-2-09.json", W9, null)).toBe(true);
    expect(shouldRevalidate("weeks/2026-2-10.json", W9, W10)).toBe(true);
    expect(shouldRevalidate("weeks/2026-2-08.json", W9, W10)).toBe(false);
    expect(shouldRevalidate("reviews/index.json", W9, null)).toBe(true);
  });
});

/** Verlauf wie im Browser, mit Einträgen und history.state. */
function fakeWindow(start: string): HashWindow & { entries: { hash: string; state: unknown }[]; index: number; events: number } {
  const w = {
    entries: [{ hash: start, state: null as unknown }],
    index: 0,
    events: 0,
    location: {
      get hash() {
        return w.entries[w.index]!.hash;
      },
      set hash(v: string) {
        w.entries = w.entries.slice(0, w.index + 1);
        w.entries.push({ hash: v, state: null });
        w.index++;
        w.events++;
      },
      get href() {
        return `https://x.test/${w.entries[w.index]!.hash}`;
      },
    },
    history: {
      get state() {
        return w.entries[w.index]!.state;
      },
      pushState(data: unknown, _u: string, url?: string) {
        w.entries = w.entries.slice(0, w.index + 1);
        w.entries.push({ hash: url ?? "", state: data });
        w.index++;
      },
      replaceState(data: unknown, _u: string, url?: string) {
        w.entries[w.index] = { hash: url ?? "", state: data };
      },
      back() {
        if (w.index > 0) {
          w.index--;
          w.events++;
        }
      },
    },
    dispatchEvent() {
      w.events++;
      return true;
    },
  };
  return w as never;
}

describe("Blatt im Verlauf (Fund 1 und 2)", () => {
  it("Schliessen geht zurück, Zurück öffnet das Blatt nicht wieder", () => {
    const w = fakeWindow("#tipps");
    openSheetHash("#tipps/g1", w);
    expect(w.entries).toHaveLength(2);
    expect(sheetEntry(w)).toBe(true);
    // Pfeile im Blatt ersetzen den Eintrag, die Marke bleibt
    replaceHash("#tipps/g2", w);
    replaceHash("#tipps/g3", w);
    expect(w.entries).toHaveLength(2);
    expect(sheetEntry(w)).toBe(true);
    closeSheetHash("#tipps", w);
    expect(w.location.hash).toBe("#tipps");
    expect(w.index).toBe(0);
  });

  it("Blatt aus einem Link von aussen ersetzt beim Schliessen den Eintrag", () => {
    const w = fakeWindow("#tipps/g1");
    closeSheetHash("#tipps", w);
    expect(w.entries).toHaveLength(1);
    expect(w.location.hash).toBe("#tipps");
  });

  it("Auswahl innerhalb der Woche legt keinen Eintrag an", () => {
    const w = fakeWindow("#spiele");
    for (const id of ["a", "b", "c"]) replaceHash(`#spiele/${id}`, w);
    expect(w.entries).toHaveLength(1);
    expect(w.location.hash).toBe("#spiele/c");
  });
});

describe("Häkchen pro Spieler (Fund 4)", () => {
  it("speichert mit Kürzel und trennt die Spieler", () => {
    const store = new MemoryStore();
    writeEntered("JA", "JA", W9, "g1", "H", store);
    writeEntered("MS", "JA", W9, "g1", "A", store);
    expect(store.map.get(enteredKey("JA", W9, "g1"))).toBe("H");
    expect(readEntered("JA", "JA", W9, "g1", store)).toBe("H");
    expect(readEntered("MS", "JA", W9, "g1", store)).toBe("A");
    expect(readEntered("LM", "JA", W9, "g1", store)).toBeNull();
  });

  it("ordnet alte Einträge ohne Kürzel dem Hauptnutzer zu", () => {
    const store = new MemoryStore();
    store.setItem(legacyEnteredKey(W9, "g1"), "H");
    expect(readEntered("JA", "JA", W9, "g1", store)).toBe("H");
    expect(readEntered("MS", "JA", W9, "g1", store)).toBeNull();
    // Abwählen löscht auch den alten Eintrag, sonst käme das Häkchen zurück
    writeEntered("JA", "JA", W9, "g1", null, store);
    expect(readEntered("JA", "JA", W9, "g1", store)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("alte Werte 1 oder true gelten als nicht eingetragen", () => {
    const store = new MemoryStore();
    store.setItem(legacyEnteredKey(W9, "g1"), "1");
    expect(readEntered("JA", "JA", W9, "g1", store)).toBeNull();
  });
});

describe("Offene Zeilen (Fund 6)", () => {
  it("gesperrte Zeilen zählen nie als offen, auch mit geändertem Tipp", () => {
    expect(entryPending(tip({ locked: true }), "changed", false)).toBe(false);
    expect(entryPending(tip({ locked: true }), "none", false)).toBe(false);
    expect(entryPending(tip(), "changed", false)).toBe(true);
    expect(entryPending(tip(), "none", false)).toBe(true);
    expect(entryPending(tip(), "done", false)).toBe(false);
    expect(entryPending(tip({ level: "nicht_erfasst" }), "none", false)).toBe(false);
    expect(entryPending(tip(), "none", true)).toBe(false);
  });
});

describe("Marke bei eigener Abweichung (Fund 8)", () => {
  it("zeigt die Abweichung statt der Lage des Favoriten", () => {
    const tips: TipsFile = {
      schemaVersion: 1,
      season: 2026,
      seasonType: 2,
      week: 9,
      updatedAt: "2026-11-05T12:00:00Z",
      maxDeviations: 0,
      tips: [tip()],
      tiebreakers: [],
    };
    const own = applyChoices(tips, [game()], { g1: "A" }).tips[0]!;
    expect(own.pickProb).toBe(0.22);
    expect(levelLabel(own, true)).toBe("deine Abweichung");
    expect(levelLabel(own, true, true)).toBe("deine Abw.");
    expect(levelLabel(own, false)).toBe("Abweichung");
    expect(levelLabel(tip(), false)).toBe("klar");
    expect(levelLabel(tip({ level: "favorit" }), false)).toBe("Favorit");
  });
});

describe("Unentschieden einheitlich (Fund 9)", () => {
  it("gleicher Text, Farbe wie falsch", () => {
    expect(RESULT_BADGE.unentschieden.text).toBe("unentschieden");
    expect(RESULT_BADGE.unentschieden.cls).toContain("res-badge-unentschieden");
    const tie = game({ status: "final", homeScore: 20, awayScore: 20 });
    expect(tipResult(tip(), tie, tie.kickoffUtc, "2026-11-09T00:00:00Z")).toBe("unentschieden");
    expect(shownResult(tip(), tie, true, 20, 20, Date.parse("2026-11-09T00:00:00Z"))).toBe("unentschieden");
    expect(reviewResult({ final: true, pickTeamId: "H", correct: false, winnerTeamId: null })).toBe("unentschieden");
    expect(reviewResult({ final: true, pickTeamId: "H", correct: false, winnerTeamId: "A" })).toBe("falsch");
    expect(reviewResult({ final: false, pickTeamId: "H", correct: null, winnerTeamId: null })).toBe("offen");
    expect(reviewResult({ final: true, pickTeamId: null, correct: null, winnerTeamId: "A" })).toBeNull();
  });
});

describe("Ergebnis aus Live Daten (Fund 10)", () => {
  const now = Date.parse("2026-11-08T21:30:00Z");
  it("Tippliste wertet den Live Endstand wie die Spielansicht", () => {
    const g = game({ status: "in_progress" });
    const merged = withLiveFinal(g, live());
    expect(merged.status).toBe("final");
    expect([merged.awayScore, merged.homeScore]).toEqual([24, 17]);
    const list = tipResult(tip(), merged, g.kickoffUtc, new Date(now).toISOString());
    const view = shownResult(tip(), g, true, 24, 17, now);
    expect(list).toBe("falsch");
    expect(view).toBe(list);
  });

  it("laufendes Spiel und Wochendatei final bleiben unverändert", () => {
    const g = game({ status: "in_progress" });
    expect(withLiveFinal(g, live({ state: "in", status: "in_progress" }))).toBe(g);
    const done = game({ status: "final", homeScore: 30, awayScore: 3 });
    expect(withLiveFinal(done, live())).toBe(done);
    expect(withLiveFinal(g, undefined)).toBe(g);
  });

  it("verschoben aus Live Daten bleibt ohne Ergebnis", () => {
    const g = game();
    expect(withLiveFinal(g, live({ state: "post", status: "postponed" }))).toBe(g);
  });
});

function review(extra: Partial<ReviewFile> = {}): ReviewFile {
  return {
    schemaVersion: 2,
    season: 2026,
    seasonType: 2,
    week: 9,
    updatedAt: "2026-11-10T06:00:00Z",
    complete: true,
    games: [
      { gameId: "g1", pickTeamId: "H", favoriteTeamId: "H", winnerTeamId: "A", final: true, correct: false, deviation: false, deviationEffect: null },
      { gameId: "g2", pickTeamId: "H2", favoriteTeamId: "H2", winnerTeamId: "H2", final: true, correct: true, deviation: false, deviationEffect: null },
      { gameId: "g3", pickTeamId: "H3", favoriteTeamId: "H3", winnerTeamId: null, final: false, correct: null, deviation: false, deviationEffect: null },
    ],
    points: 1,
    tipped: 3,
    deviationNet: 0,
    tiebreakers: [],
    ...extra,
  };
}

describe("Eigene Wahl in Bilanz und Saison (Fund 11, D057)", () => {
  it("rechnet Punkte und Netto mit der eigenen Wahl", () => {
    const { review: r, changed } = applyChoicesToReview(review(), { g1: "A", g2: "A2", g3: "A3" });
    expect(changed).toBe(3);
    expect(r.points).toBe(1); // g1 richtig, g2 jetzt falsch
    expect(r.deviationNet).toBe(0); // +1 und -1, g3 offen
    expect(r.games[0]).toMatchObject({ pickTeamId: "A", deviation: true, correct: true, deviationEffect: 1 });
    expect(r.games[1]).toMatchObject({ pickTeamId: "A2", correct: false, deviationEffect: -1 });
    expect(r.games[2]).toMatchObject({ pickTeamId: "A3", correct: null, deviationEffect: null });
  });

  it("ohne Wahl oder mit fremdem Team bleibt die Bilanz", () => {
    const base = review();
    expect(applyChoicesToReview(base, {}).review).toBe(base);
    const games = [game({ id: "g1" })];
    expect(applyChoicesToReview(base, { g1: "X" }, games).changed).toBe(0);
    expect(applyChoicesToReview(base, { g1: "H" }).changed).toBe(0);
  });

  it("Unentschieden mit eigener Wahl zählt falsch, Wirkung 0", () => {
    const tie = review({
      games: [{ gameId: "g1", pickTeamId: "H", favoriteTeamId: "H", winnerTeamId: null, final: true, correct: false, deviation: false, deviationEffect: null }],
      points: 0,
      tipped: 1,
    });
    const r = applyChoicesToReview(tie, { g1: "A" }).review;
    expect(r.games[0]).toMatchObject({ correct: false, deviationEffect: 0 });
  });

  it("Saisonwerte enthalten die Wahl pro Woche", () => {
    const tips: TipsFile = {
      schemaVersion: 1,
      season: 2026,
      seasonType: 2,
      week: 9,
      updatedAt: "2026-11-05T12:00:00Z",
      maxDeviations: 0,
      tips: [tip(), tip({ gameId: "g2", pickTeamId: "H2", pickProb: 0.6, pHome: 0.6, level: "unklar" })],
      tiebreakers: [],
    };
    const own = applySeasonChoices([review()], [tips], new Map([["2026-2-09", { g1: "A" }]]));
    expect(own.changed).toBe(1);
    expect(own.tips[0]!.tips[0]).toMatchObject({ pickTeamId: "A", pickProb: 0.22, deviation: true });
    const s = buildSeasonSummary({ season: 2026, reviews: own.reviews, tips: own.tips });
    expect(s.appPoints).toBe(2);
    expect(s.favoritePoints).toBe(1);
    expect(s.deviations).toMatchObject({ count: 1, scored: 1, hits: 1, net: 1 });
    // Erwartung laut Quote: 2 mal 0.22 minus 1
    expect(s.deviations.expectedNet).toBeCloseTo(-0.56, 4);
    const other = applySeasonChoices([review()], [tips], new Map([["2026-2-10", { g1: "A" }]]));
    expect(other.changed).toBe(0);
  });
});

describe("Oberfläche (Funde 20, 25, 26)", () => {
  it("Logo Variante für dunkle Flächen", () => {
    expect(darkLogoUrl("https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ari.png")).toBe(
      "https://a.espncdn.com/i/teamlogos/nfl/500-dark/scoreboard/ari.png",
    );
    expect(darkLogoUrl(null)).toBeNull();
    expect(darkLogoUrl("https://example.com/logo.png")).toBeNull();
  });

  it("Werbeartikel erkannt, gross und klein egal", () => {
    expect(isPromo({ title: "DraftKings Promo Code: get $200" })).toBe(true);
    expect(isPromo({ title: "FanDuel bonus codes for NFL Week 10" })).toBe(true);
    expect(isPromo({ title: "Bears beat Seahawks", summary: "Use BONUS-CODE now" })).toBe(true);
    expect(isPromo({ title: "Bears beat Seahawks", summary: null })).toBe(false);
    expect(isPromo({ title: "Promotion for coordinator" })).toBe(false);
  });

  it("Teamfarbe im Hellmodus abgedunkelt, im Dunkelmodus aufgehellt", () => {
    const light = visibleOn("#FFB612", "#FFFFFF", 2);
    expect(contrast(light, "#FFFFFF")).toBeGreaterThanOrEqual(2);
    const dark = visibleOn("#0B162A", "#171B22", 2);
    expect(contrast(dark, "#171B22")).toBeGreaterThanOrEqual(2);
  });
});
