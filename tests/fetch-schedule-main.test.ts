import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchJson, main, type FetchFn } from "../jobs/fetch-schedule";

const fixtureText = readFileSync(new URL("./fixtures/espn-scoreboard-2026-w8.json", import.meta.url), "utf8");
const WEEK_PATH = "weeks/2026-2-08.json";

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
  it("schreibt gültige Dateien bei Erfolg", async () => {
    expect(await main([], deps(respond(fixtureText)))).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(["current.json", "settings.json", "teams.json", "weeks"]);
  });

  for (const [name, fetch] of [
    ["HTTP 500", respond("boom", 500)],
    ["kein JSON", respond("<html>")],
    ["Netzfehler", failing],
    ["Schemafehler", respond('{"events":[]}')],
  ] as const) {
    it(`${name} liefert Exit Code 1 und lässt Dateien unverändert`, async () => {
      expect(await main([], deps(respond(fixtureText)))).toBe(0);
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
