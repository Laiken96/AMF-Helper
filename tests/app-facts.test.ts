import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTS_FIRST_WEEK, loadFactsData, resetDataCacheForTests } from "../src/app/data";
import {
  FPI_GAP_PTS,
  absenceText,
  candidateText,
  deviationSignals,
  fpiFact,
  keyAbsence,
  marketFact,
  picksFact,
  signedSpread,
  venueFact,
} from "../src/app/facts";
import type { InjuriesFile, KeyPlayer } from "../src/core/injuries";
import type { GameTip } from "../src/core/tips-schema";

const ABBR: Record<string, string> = { "1": "ATL", "4": "CIN", "30": "JAX", "33": "BAL" };
const abbr = (id: string) => ABBR[id] ?? `#${id}`;

const odds = (spreadHome: number) => ({ provider: "DraftKings", spreadHome, overUnder: 44.5, fetchedAt: "2026-11-02T21:47:17Z" });

// CIN @ ATL in Madrid, App tippt den Aussenseiter ATL
const game = { homeId: "1", awayId: "4" };

const tip = (over: Partial<GameTip> = {}): GameTip => ({
  gameId: "401873038",
  kickoffUtc: "2026-11-08T14:30:00Z",
  odds: odds(3),
  pHome: 0.4121,
  pickTeamId: "1",
  pickProb: 0.4121,
  level: "unklar",
  deviation: true,
  firstPickTeamId: "4",
  firstOdds: odds(3),
  changedSinceFirst: true,
  locked: false,
  lockedAt: null,
  ...over,
});

describe("signedSpread", () => {
  it("mit echtem Minus und Plus", () => {
    expect(signedSpread(-3)).toBe("−3");
    expect(signedSpread(2.5)).toBe("+2.5");
    expect(signedSpread(0)).toBe("0");
  });
});

describe("marketFact", () => {
  it("ohne Bewegung keine Startlinie", () => {
    const m = marketFact(tip(), game, abbr)!;
    expect(m.prob).toBe("ATL 41 %");
    expect(m.line).toBe("Linie CIN −3");
    expect(m.start).toBeNull();
    expect(m.spoken).toBe("Siegwahrscheinlichkeit ATL 41 Prozent, Linie CIN minus 3");
  });

  it("Startlinie aus Sicht des aktuellen Favoriten", () => {
    const m = marketFact(tip({ firstOdds: odds(9) }), game, abbr)!;
    expect(m.line).toBe("Linie CIN −3");
    expect(m.start).toBe("Start −9");
    expect(m.spoken).toContain("zu Beginn minus 9");
  });

  it("Favoritenwechsel zeigt die Startlinie mit Plus", () => {
    const m = marketFact(tip({ odds: odds(-2.5), firstOdds: odds(3) }), game, abbr)!;
    expect(m.line).toBe("Linie ATL −2.5");
    expect(m.start).toBe("Start +3");
  });

  it("ausgeglichene Linie mit Startlinie aus Sicht Heimteam", () => {
    const m = marketFact(tip({ odds: odds(0), firstOdds: odds(-1.5) }), game, abbr)!;
    expect(m.line).toBe("Linie ausgeglichen");
    expect(m.start).toBe("Start −1.5 ATL");
  });

  it("ohne Quote und ohne Tipp null", () => {
    expect(marketFact(tip({ odds: null, pickTeamId: null, pickProb: null, level: "offen" }), game, abbr)).toBeNull();
    expect(marketFact(undefined, game, abbr)).toBeNull();
  });

  it("nicht erfasster Tipp zeigt nur die Linie", () => {
    const m = marketFact(tip({ level: "nicht_erfasst" }), game, abbr)!;
    expect(m.prob).toBeNull();
    expect(m.line).toBe("Linie CIN −3");
  });
});

describe("fpiFact", () => {
  const fpi = { homeId: "1", awayId: "4", pHome: 0.223, pAway: 0.771 };

  it("Wahrscheinlichkeit des getippten Teams und deutliche Abweichung", () => {
    const f = fpiFact(fpi, game, tip(), abbr)!;
    expect(f).toMatchObject({ abbr: "ATL", pct: 22, gap: -19, large: true, gapText: "19 Punkte unter dem Markt" });
  });

  it("kleine Abweichung ohne Markierung", () => {
    const f = fpiFact({ ...fpi, pHome: 0.5 }, game, tip(), abbr)!;
    expect(f.gap).toBe(9);
    expect(f.large).toBe(false);
    expect(f.gapText).toBeNull();
  });

  it("Grenze bei FPI_GAP_PTS", () => {
    const f = fpiFact({ ...fpi, pHome: 0.41 + FPI_GAP_PTS / 100 }, game, tip(), abbr)!;
    expect(f.gap).toBe(FPI_GAP_PTS);
    expect(f.large).toBe(true);
    expect(f.gapText).toBe(`${FPI_GAP_PTS} Punkte über dem Markt`);
  });

  it("ohne Tipp das FPI Favoritenteam, ohne Vergleich", () => {
    const f = fpiFact(fpi, game, tip({ pickTeamId: null, pickProb: null, level: "offen" }), abbr)!;
    expect(f).toMatchObject({ abbr: "CIN", pct: 77, gap: null, large: false });
  });

  it("fehlend oder andere Teams null", () => {
    expect(fpiFact(undefined, game, tip(), abbr)).toBeNull();
    expect(fpiFact({ ...fpi, homeId: "4", awayId: "1" }, game, tip(), abbr)).toBeNull();
  });
});

describe("picksFact", () => {
  const picks = { homeId: "1", awayId: "4", homeShare: 0.122, awayShare: 0.878, total: 90653 };

  it("Mehrheit, Balkenanteile und Anteil für den getippten Aussenseiter", () => {
    const p = picksFact(picks, game, tip(), abbr)!;
    expect(p.headline).toBe("88 % tippen CIN");
    expect(p.awayPct + p.homePct).toBe(100);
    expect(p.homePct).toBe(12);
    expect(p.pickNote).toBe("Tipp ATL: 12 % tippen so");
    expect(p.sample).toMatch(/^90.653 Tipps bei ESPN$/);
  });

  it("Tipp mit der Mehrheit ohne Zusatz", () => {
    const p = picksFact(picks, game, tip({ pickTeamId: "4" }), abbr)!;
    expect(p.pickNote).toBeNull();
  });

  it("fehlend, leer oder andere Teams null", () => {
    expect(picksFact(null, game, tip(), abbr)).toBeNull();
    expect(picksFact({ ...picks, total: 0 }, game, tip(), abbr)).toBeNull();
    expect(picksFact({ ...picks, homeId: "33" }, game, tip(), abbr)).toBeNull();
  });
});

describe("venueFact", () => {
  const base = { homeId: "1", awayId: "4", venue: "Santiago Bernabéu", neutralSite: false };

  it("Ort ausserhalb der USA mit Land auf Deutsch und neutralem Platz", () => {
    const v = venueFact(
      { ...base, neutralSite: true, venueInfo: { name: "Santiago Bernabéu", city: "Madrid", country: "Spain" }, awayRest: 7, homeRest: 7 },
      abbr,
    )!;
    expect(v).toEqual({ place: "Santiago Bernabéu, Madrid, Spanien", neutral: true, rest: "CIN 7, ATL 7", short: null });
  });

  it("USA ohne Land, kurze Woche markiert", () => {
    const v = venueFact(
      { ...base, homeId: "33", awayId: "30", venueInfo: { name: "M&T Bank Stadium", city: "Baltimore", country: "USA" }, awayRest: 4, homeRest: 7 },
      abbr,
    )!;
    expect(v.place).toBe("M&T Bank Stadium, Baltimore");
    expect(v.rest).toBe("JAX 4, BAL 7");
    expect(v.short).toBe("kurze Woche JAX");
  });

  it("Wochendatei Version 1: nur Stadionname, Ruhetage fehlen", () => {
    const v = venueFact(base, abbr)!;
    expect(v).toEqual({ place: "Santiago Bernabéu", neutral: false, rest: null, short: null });
  });

  it("ein Team ohne früheres Spiel", () => {
    const v = venueFact({ ...base, awayRest: null, homeRest: 13 }, abbr)!;
    expect(v.rest).toBe("ATL 13");
  });

  it("ohne Angaben null", () => {
    expect(venueFact({ ...base, venue: null }, abbr)).toBeNull();
  });
});

describe("loadFactsData", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const ref = { season: 2026, seasonType: 2, week: 9 };
  const fpiFile = {
    schemaVersion: 1,
    ...ref,
    updatedAt: "2026-11-02T20:00:00Z",
    games: [{ gameId: "g1", kickoffUtc: "2026-11-08T14:30:00Z", homeId: "1", awayId: "4", pHome: 0.22, pAway: 0.77, fetchedAt: "2026-11-02T20:00:00Z", locked: false }],
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetDataCacheForTests();
    vi.stubGlobal("window", new EventTarget());
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fehlende und ungültige Dateien ergeben null, nie einen Fehler", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("fpi/2026-2-09.json") ? ok(fpiFile) : url.includes("picks/") ? ok({ schemaVersion: 1, kaputt: true }) : new Response("", { status: 404 }),
    );
    const data = await loadFactsData(ref);
    expect(data.fpi?.games[0]?.pHome).toBe(0.22);
    expect(data.picks).toBeNull();
    resetDataCacheForTests();
    fetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    expect(await loadFactsData(ref)).toEqual({ fpi: null, picks: null, injuries: null });
  });

  it("Netzwerkfehler ergibt null", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await loadFactsData(ref)).toEqual({ fpi: null, picks: null, injuries: null });
  });

  it("Datei einer anderen Woche zählt als fehlend", async () => {
    fetchMock.mockImplementation(async () => ok({ ...fpiFile, week: 8 }));
    expect((await loadFactsData(ref)).fpi).toBeNull();
  });

  it("Wochen nach der nächsten Tippwoche werden nicht abgefragt", async () => {
    const current = { schemaVersion: 1, season: 2026, seasonType: 2, week: 9, weekFile: "weeks/2026-2-09.json", updatedAt: "2026-11-02T20:00:00Z" };
    fetchMock.mockImplementation(async (url: string) => (url.includes("current.json") ? ok(current) : new Response("", { status: 404 })));
    await loadFactsData({ ...ref, week: 11 });
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes("current.json"))).toEqual([]);
    await loadFactsData({ ...ref, week: 10 });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("fpi/2026-2-10.json"))).toBe(true);
    // Ausfälle der nächsten Woche schreibt der Wächter ebenso (D050), 404 bleibt still
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("injuries/2026-2-10.json"))).toBe(true);
  });

  it("Wochen vor FACTS_FIRST_WEEK werden nicht abgefragt", async () => {
    await loadFactsData({ ...FACTS_FIRST_WEEK, week: FACTS_FIRST_WEEK.week - 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Signale für eine eigene Abweichung (D052)", () => {
  // CIN @ ATL: CIN Favorit 59 %, ATL Heim 41 %
  const g = { id: "401873038", homeId: "1", awayId: "4" };
  const base = { pHome: 0.4121, odds: odds(3), firstOdds: odds(3) };
  const player = (over: Partial<KeyPlayer>): KeyPlayer => ({
    athleteId: "1",
    name: "Joe Burrow",
    pos: "QB",
    teamId: "4",
    teamAbbr: "CIN",
    roles: ["qb", "passing"],
    status: "Out",
    ...over,
  });
  const inj = (players: KeyPlayer[]): InjuriesFile => ({
    schemaVersion: 1,
    season: 2026,
    seasonType: 2,
    week: 9,
    baselineFrom: "2026-11-05T05:00:00Z",
    baseline: null,
    current: { takenAt: "2026-11-05T05:00:00Z", games: [{ gameId: g.id, kickoffUtc: "2026-11-08T14:30:00Z", players }] },
    changes: [],
  });

  it("ohne Bewegung, FPI und Ausfall keine Signale", () => {
    expect(deviationSignals({ tip: base, game: g, abbr })).toEqual([]);
    expect(deviationSignals({ tip: { ...base, pHome: null }, game: g, abbr })).toEqual([]);
  });

  it("Linie bewegt sich zum Aussenseiter ab 1 Punkt, nicht in die andere Richtung", () => {
    // Start CIN -5, jetzt -3: Richtung ATL
    const s = deviationSignals({ tip: { ...base, firstOdds: odds(5) }, game: g, abbr });
    expect(s).toEqual([{ kind: "linie", text: "Linie bewegt sich zu ATL: CIN −5 > −3" }]);
    expect(deviationSignals({ tip: { ...base, firstOdds: odds(3.5) }, game: g, abbr })).toEqual([]);
    expect(deviationSignals({ tip: { ...base, firstOdds: odds(1) }, game: g, abbr })).toEqual([]);
  });

  it("FPI sieht den Aussenseiter ab 5 Prozentpunkten stärker als der Markt", () => {
    const fpi = (pHome: number) => ({ homeId: "1", awayId: "4", pHome, pAway: 1 - pHome });
    expect(deviationSignals({ tip: base, game: g, fpi: fpi(0.46), abbr })).toEqual([
      { kind: "fpi", text: "ESPN FPI sieht ATL bei 46 %, der Markt bei 41 %" },
    ]);
    expect(deviationSignals({ tip: base, game: g, fpi: fpi(0.45), abbr })).toEqual([]);
    // Teams passen nicht zum Spiel
    expect(deviationSignals({ tip: base, game: g, fpi: { ...fpi(0.7), homeId: "x" }, abbr })).toEqual([]);
  });

  it("wichtiger Ausfall nur beim Favoriten zählt", () => {
    expect(deviationSignals({ tip: base, game: g, injuries: inj([player({})]), abbr })).toEqual([
      { kind: "ausfall", text: "Ausfall beim Favoriten: CIN ohne Joe Burrow (QB, Out)" },
    ]);
    const atl = player({ teamId: "1", teamAbbr: "ATL", name: "Bijan Robinson", pos: "RB", roles: ["rushing"] });
    expect(deviationSignals({ tip: base, game: g, injuries: inj([atl]), abbr })).toEqual([]);
    expect(deviationSignals({ tip: base, game: g, injuries: inj([player({ status: "Questionable" })]), abbr })).toEqual([]);
  });

  it("keyAbsence mit Team und Text für fraglich", () => {
    const d = player({ status: "Doubtful" });
    expect(keyAbsence(inj([d]), g.id, "4")).toEqual(d);
    expect(keyAbsence(inj([d]), g.id, "1")).toBeNull();
    expect(absenceText(d)).toBe("CIN: Joe Burrow fraglich (QB, Doubtful)");
  });

  it("Kandidatenhinweis mit und ohne Tippverteilung", () => {
    const c = { gameId: g.id, favoriteId: "4", underdogId: "1", favoriteProb: 0.5879, underdogShare: 0.28, withoutPicks: false };
    expect(candidateText(c, abbr)).toBe("Knappes Spiel, CIN 59 %. ATL tippen nur 28 % bei ESPN.");
    expect(candidateText({ ...c, underdogShare: null, withoutPicks: true }, abbr)).toBe("Knappes Spiel, CIN 59 %, ohne Tippverteilung.");
  });
});
