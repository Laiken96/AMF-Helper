import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseScoreboard } from "../src/core/espn";
import {
  PICKS_MIN_CHANGE,
  PicksFileSchema,
  buildPicksFile,
  parsePickem,
  pickemUrl,
  picksFilePath,
  samePicksContent,
  type PickemResponse,
} from "../src/core/picks";
import { main as picks } from "../jobs/picks";
import type { FetchFn } from "../jobs/fetch-schedule";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pickemW9Text = read("./fixtures/espn-pickem-2026-w9.json");
const pickemW8Text = read("./fixtures/espn-pickem-2026-w8.json");
const sb = parseScoreboard(JSON.parse(read("./fixtures/espn-scoreboard-2026-w9.json")), { fetchedAt: "2026-11-02T00:00:00Z" });
if (!sb.ok) throw new Error(sb.error);
const w9 = sb.week;

const T0 = "2026-11-02T22:00:00Z";
const T1 = "2026-11-03T22:00:00Z";
const AFTER_TNF = "2026-11-06T02:00:00Z";

function response(text = pickemW9Text): PickemResponse {
  const r = parsePickem(JSON.parse(text));
  if (!r.ok) throw new Error(r.error);
  return r.response;
}
const build = (now: string, existing: ReturnType<typeof buildPicksFile>["file"] | null = null, res = response()) =>
  buildPicksFile({ season: 2026, seasonType: 2, week: 9, games: w9.games, response: res, existing, now });

describe("Pick'em Antwort", () => {
  it("URL und Pfad", () => {
    expect(pickemUrl(2026, 9)).toBe("https://gambit-api.fantasy.espn.com/apis/v1/challenges/nfl-pickem-2026?view=chui_default&scoringPeriodId=9");
    expect(picksFilePath(2026, 2, 9)).toBe("picks/2026-2-09.json");
  });

  it("echte Antwort Week 9 ordnet alle 15 Spiele zu, Format mit grösster Stichprobe", () => {
    const { file, unmatched } = build(T0);
    expect(unmatched).toEqual([]);
    expect(file.games).toHaveLength(15);
    expect(PicksFileSchema.safeParse(file).success).toBe(true);
    // JAX@BAL: Format 1 mit 54882 zu 37569
    const tnf = file.games.find((g) => g.gameId === "401873037")!;
    expect(tnf).toEqual({
      gameId: "401873037",
      homeId: "33",
      awayId: "30",
      homeShare: 0.406,
      awayShare: 0.594,
      total: 92451,
      scoringFormatId: 1,
      fetchedAt: T0,
      locked: false,
    });
    expect(file.games.every((g) => g.scoringFormatId === 1)).toBe(true);
    expect(file.games.every((g) => Math.abs(g.homeShare + g.awayShare - 1) < 1e-9)).toBe(true);
  });

  it("Propositions einer anderen Woche werden nicht zugeordnet", () => {
    const { file, unmatched } = build(T0, null, response(pickemW8Text));
    expect(file.games).toEqual([]);
    expect(unmatched).toHaveLength(15);
  });

  it("unbekannte Struktur wird abgelehnt", () => {
    expect(parsePickem({ propositions: "x" }).ok).toBe(false);
    expect(parsePickem({}).ok).toBe(false);
    expect(parsePickem(null).ok).toBe(false);
  });

  it("ohne COMPETITOR_ID gilt subType, ohne Zähler kein Eintrag", () => {
    const raw = JSON.parse(pickemW9Text);
    for (const p of raw.propositions) for (const o of p.possibleOutcomes) o.mappings = o.mappings.filter((m: any) => m.type !== "COMPETITOR_ID");
    raw.propositions[0].possibleOutcomes.forEach((o: any) => (o.choiceCounters = []));
    const { file, unmatched } = build(T0, null, response(JSON.stringify(raw)));
    expect(file.games).toHaveLength(14);
    expect(unmatched).toEqual([raw.propositions[0].mappings.find((m: any) => m.type === "EVENT_ID").value]);
    expect(file.games.find((g) => g.gameId === "401873037")).toMatchObject({ homeShare: 0.406, awayShare: 0.594 });
  });

  it("gleiche Anteile behalten den Eintrag, Kickoff friert ein", () => {
    const a = build(T0).file;
    const b = build(T1, a).file;
    expect(samePicksContent(a, b)).toBe(true);
    const raw = JSON.parse(pickemW9Text);
    for (const p of raw.propositions) for (const o of p.possibleOutcomes) for (const c of o.choiceCounters) if (o.abbrev === "BAL") c.count *= 3;
    const moved = build(T1, a, response(JSON.stringify(raw))).file.games.find((g) => g.gameId === "401873037")!;
    expect(moved.homeShare).toBeGreaterThan(0.6);
    expect(moved.fetchedAt).toBe(T1);
    const frozen = build(AFTER_TNF, a, response(JSON.stringify(raw))).file.games.find((g) => g.gameId === "401873037")!;
    expect(frozen).toMatchObject({ homeShare: 0.406, fetchedAt: T0, locked: true });
  });
});

describe("kleine Schwankungen (D057)", () => {
  // Stärkt das Heimteam im TNF um den Faktor f und liefert den neuen Heimanteil samt fetchedAt.
  const shifted = (f: number, existing: ReturnType<typeof buildPicksFile>["file"]) => {
    const raw = JSON.parse(pickemW9Text);
    for (const p of raw.propositions) for (const o of p.possibleOutcomes) for (const c of o.choiceCounters) if (o.abbrev === "BAL") c.count = Math.round(c.count * f);
    return build(T1, existing, response(JSON.stringify(raw))).file;
  };

  it("unter 0.5 Prozentpunkten bleibt der Eintrag samt fetchedAt, die Datei ist gleich", () => {
    const a = build(T0).file;
    const b = shifted(1.01, a); // rund 0.24 Prozentpunkte
    expect(samePicksContent(a, b)).toBe(true);
    expect(b.games.find((g) => g.gameId === "401873037")).toMatchObject({ homeShare: 0.406, fetchedAt: T0 });
  });

  it("ab 0.5 Prozentpunkten neuer Anteil und neues fetchedAt nur für dieses Spiel", () => {
    const a = build(T0).file;
    const b = shifted(1.03, a); // rund 0.7 Prozentpunkte
    const tnf = b.games.find((g) => g.gameId === "401873037")!;
    expect(tnf.homeShare - 0.406).toBeGreaterThanOrEqual(PICKS_MIN_CHANGE);
    expect(tnf.fetchedAt).toBe(T1);
    expect(b.games.filter((g) => g.fetchedAt === T1).map((g) => g.gameId)).toEqual(["401873037"]);
  });
});

describe("jobs/picks.ts", () => {
  let dir: string;
  let logs: string[];
  let errors: string[];
  const PICKS9 = "picks/2026-2-09.json";
  const PICKS10 = "picks/2026-2-10.json";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nfl-picks-"));
    await mkdir(join(dir, "weeks"));
    await writeFile(
      join(dir, "current.json"),
      JSON.stringify({ schemaVersion: 1, season: 2026, seasonType: 2, week: 9, weekFile: "weeks/2026-2-09.json", updatedAt: "2026-11-02T00:00:00Z" }),
    );
    await writeFile(join(dir, "weeks/2026-2-09.json"), JSON.stringify(w9));
    logs = [];
    errors = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const deps = (fetch: FetchFn, now = T0) => ({
    dataDir: dir,
    now: () => now,
    fetch,
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  });
  const urls: string[] = [];
  const ok = (text = pickemW9Text): FetchFn => async (url) => {
    urls.push(url);
    return new Response(text, { status: 200 });
  };
  const readPicks = async (p = PICKS9) => PicksFileSchema.parse(JSON.parse(await readFile(join(dir, p), "utf8")));

  it("schreibt die aktuelle Woche, ohne Wochendatei keine nächste", async () => {
    urls.length = 0;
    expect(await picks([], deps(ok()))).toBe(0);
    expect((await readPicks()).games).toHaveLength(15);
    expect(urls).toEqual([pickemUrl(2026, 9)]);
    expect(errors).toEqual([]);
  });

  it("nächste Woche mit Wochendatei wird ebenfalls abgefragt", async () => {
    const w10 = { ...w9, week: 10, games: w9.games.map((g) => ({ ...g, week: 10 })) };
    await writeFile(join(dir, "weeks/2026-2-10.json"), JSON.stringify(w10));
    urls.length = 0;
    expect(await picks([], deps(ok()))).toBe(0);
    expect(urls).toEqual([pickemUrl(2026, 9), pickemUrl(2026, 10)]);
    // Die Antwort enthält nur Week 9, also keine Datei für Week 10 und eine Warnung
    await expect(readFile(join(dir, PICKS10), "utf8")).rejects.toThrow();
    expect(errors.some((e) => e.startsWith("Warnung") && e.includes("2026-2-10"))).toBe(true);
  });

  it("schreibt nicht neu ohne Änderung", async () => {
    await picks([], deps(ok()));
    const before = await readFile(join(dir, PICKS9), "utf8");
    await picks([], deps(ok(), T1));
    expect(await readFile(join(dir, PICKS9), "utf8")).toBe(before);
    expect(logs.at(-1)).toContain("unverändert");
  });

  it("HTTP Fehler: Warnung, Exit 0, Datei bleibt", async () => {
    await picks([], deps(ok()));
    const before = await readFile(join(dir, PICKS9), "utf8");
    const fail: FetchFn = async () => new Response("x", { status: 503 });
    expect(await picks([], deps(fail, T1))).toBe(0);
    expect(await readFile(join(dir, PICKS9), "utf8")).toBe(before);
    expect(errors[0]).toMatch(/^Warnung.*HTTP 503/);
  });

  it("Netzfehler wirft nicht", async () => {
    const boom: FetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await picks([], deps(boom))).toBe(0);
    expect(errors[0]).toContain("fetch failed");
  });

  it("unbekannte Struktur: Warnung, Exit 0, keine Datei", async () => {
    expect(await picks([], deps(ok(JSON.stringify({ foo: 1 }))))).toBe(0);
    await expect(readFile(join(dir, PICKS9), "utf8")).rejects.toThrow();
    expect(errors[0]).toContain("unbekannte Struktur");
  });

  it("kaputte bestehende Datei wird nicht überschrieben", async () => {
    await mkdir(join(dir, "picks"));
    await writeFile(join(dir, PICKS9), "{kaputt");
    expect(await picks([], deps(ok()))).toBe(0);
    expect(await readFile(join(dir, PICKS9), "utf8")).toBe("{kaputt");
  });

  it("fehlende current.json und Postseason ergeben Exit 0 ohne Abruf", async () => {
    await rm(join(dir, "current.json"));
    urls.length = 0;
    expect(await picks([], deps(ok()))).toBe(0);
    expect(await picks(["--season", "2026", "--type", "3", "--week", "1"], deps(ok()))).toBe(0);
    expect(urls).toEqual([]);
  });
});
