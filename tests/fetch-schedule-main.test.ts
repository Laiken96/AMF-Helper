import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchJson, main, type FetchFn } from "../jobs/fetch-schedule";

const fixtureText = readFileSync(new URL("./fixtures/espn-scoreboard-2026-w8.json", import.meta.url), "utf8");
const w9Text = readFileSync(new URL("./fixtures/espn-scoreboard-2026-w9.json", import.meta.url), "utf8");
const WEEK_PATH = "weeks/2026-2-08.json";

/** Fixture Week 9 als Week n umgeschrieben, damit kommende Wochen ohne Netz testbar sind. */
function asWeek(n: number, drop = 0): string {
  const raw = JSON.parse(w9Text);
  raw.week.number = n;
  for (const e of raw.events) {
    if (e.week) e.week.number = n;
    e.id = `${e.id}${n}`;
  }
  raw.events = raw.events.slice(drop);
  return JSON.stringify(raw);
}

/** Aktuelle Woche ist Week 8, kommende Wochen 9 und 10 nach Query Parameter. */
const router = (overrides: Record<number, FetchFn> = {}): FetchFn => async (url, init) => {
  const week = new URL(url).searchParams.get("week");
  if (week === null) return new Response(fixtureText);
  const n = Number(week);
  if (overrides[n]) return overrides[n]!(url, init);
  return new Response(asWeek(n));
};

const respond = (body: string, status = 200): FetchFn => async () => new Response(body, { status });
const failing: FetchFn = async () => {
  throw new TypeError("fetch failed");
};

let dir: string;
let errors: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-main-"));
  errors = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (fetch: FetchFn) => ({
  fetch,
  dataDir: dir,
  now: () => "2026-11-02T02:00:00Z",
  log: () => {},
  error: (m: string) => errors.push(m),
});

async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of ["teams.json", "current.json", "settings.json", WEEK_PATH]) {
    out[p] = await readFile(join(dir, p), "utf8");
  }
  return out;
}

describe("fetchJson", () => {
  it("wirft bei HTTP 500", async () => {
    await expect(fetchJson("https://x", respond("boom", 500))).rejects.toThrow("HTTP 500");
  });
  it("wirft bei Antwort ohne JSON", async () => {
    await expect(fetchJson("https://x", respond("<html>"))).rejects.toThrow("kein JSON");
  });
  it("setzt User-Agent und Timeout Signal", async () => {
    let init: RequestInit | undefined;
    await fetchJson("https://x", async (_url, i) => {
      init = i;
      return new Response("{}");
    });
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/nfl-dashboard/);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("main", () => {
  it("schreibt gültige Dateien bei Erfolg, dazu die nächsten 2 Wochen", async () => {
    expect(await main([], deps(router()))).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(["current.json", "settings.json", "teams.json", "weeks"]);
    expect((await readdir(join(dir, "weeks"))).sort()).toEqual(["2026-2-08.json", "2026-2-09.json", "2026-2-10.json"]);
    const current = JSON.parse(await readFile(join(dir, "current.json"), "utf8"));
    expect(current.week).toBe(8);
    const w10 = JSON.parse(await readFile(join(dir, "weeks/2026-2-10.json"), "utf8"));
    expect(w10.week).toBe(10);
    expect(w10.games.length).toBeGreaterThan(0);
  });

  it("Fehler einer kommenden Woche lässt die aktuelle gültig, Exit Code 1", async () => {
    expect(await main([], deps(router({ 9: respond("boom", 500) })))).toBe(1);
    expect(errors.join("\n")).toMatch(/2026-2-9.*unverändert/);
    expect((await readdir(join(dir, "weeks"))).sort()).toEqual(["2026-2-08.json", "2026-2-10.json"]);
  });

  it("D019 gilt auch für kommende Wochen", async () => {
    expect(await main([], deps(router()))).toBe(0);
    const before = await readFile(join(dir, "weeks/2026-2-09.json"), "utf8");
    const shrink: FetchFn = async () => new Response(asWeek(9, 3));
    expect(await main([], deps(router({ 9: shrink })))).toBe(1);
    expect(errors.join("\n")).toMatch(/Spiele fehlen/);
    expect(await readFile(join(dir, "weeks/2026-2-09.json"), "utf8")).toBe(before);
  });

  it("falsche Woche von ESPN wird nicht geschrieben", async () => {
    const wrong: FetchFn = async () => new Response(asWeek(12));
    expect(await main([], deps(router({ 10: wrong })))).toBe(1);
    expect(errors.join("\n")).toMatch(/lieferte 2026-2-12/);
    expect((await readdir(join(dir, "weeks"))).sort()).toEqual(["2026-2-08.json", "2026-2-09.json"]);
  });

  it("explizite Woche holt keine kommenden Wochen", async () => {
    const urls: string[] = [];
    const spy: FetchFn = async (url, init) => {
      urls.push(url);
      return router()(url, init);
    };
    expect(await main(["--season", "2026", "--type", "2", "--week", "9"], deps(spy))).toBe(0);
    expect(urls).toHaveLength(1);
  });

  for (const [name, fetch] of [
    ["HTTP 500", respond("boom", 500)],
    ["kein JSON", respond("<html>")],
    ["Netzfehler", failing],
    ["Schemafehler", respond('{"events":[]}')],
  ] as const) {
    it(`${name} liefert Exit Code 1 und lässt Dateien unverändert`, async () => {
      expect(await main([], deps(router()))).toBe(0);
      const before = await snapshot();
      expect(await main([], deps(fetch))).toBe(1);
      expect(errors.join("\n")).toMatch(/unverändert/);
      expect(await snapshot()).toEqual(before);
    });
  }

  it("Netzfehler ohne bestehende Daten schreibt nichts", async () => {
    expect(await main([], deps(failing))).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it("ungültige Argumente liefern Exit Code 1", async () => {
    expect(await main(["--foo"], deps(respond(fixtureText)))).toBe(1);
  });
});

describe("Wochenwechsel nach dem letzten Spiel (D055)", () => {
  /** Week 8 Fixture mit allen Spielen beendet. */
  function allFinal(): string {
    const raw = JSON.parse(fixtureText);
    for (const e of raw.events) {
      const st = e.competitions[0].status ?? e.status;
      st.type = { ...st.type, name: "STATUS_FINAL", state: "post", completed: true };
      e.competitions[0].status = st;
      e.status = st;
    }
    return JSON.stringify(raw);
  }
  const finalRouter: FetchFn = async (url) => {
    const week = new URL(url).searchParams.get("week");
    return new Response(week === null ? allFinal() : asWeek(Number(week)));
  };
  const current = async () => JSON.parse(await readFile(join(dir, "current.json"), "utf8"));

  it("alle Spiele beendet: nächste Woche wird aktuell", async () => {
    expect(await main([], deps(finalRouter))).toBe(0);
    expect(await current()).toMatchObject({ season: 2026, seasonType: 2, week: 9, weekFile: "weeks/2026-2-09.json" });
  });

  it("ESPN meldet danach noch Week 8: current springt nicht zurück", async () => {
    await main([], deps(finalRouter));
    expect(await main([], deps(router()))).toBe(0);
    expect((await current()).week).toBe(9);
  });

  it("offene Spiele: current bleibt bei der ESPN Woche", async () => {
    await main([], deps(router()));
    expect((await current()).week).toBe(8);
  });
});
