import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main as watch } from "../jobs/watch";
import { EXPIRED_MESSAGE, main as push, type SendFn } from "../jobs/push";
import type { FetchFn } from "../jobs/fetch-schedule";
import { parseScoreboard } from "../src/core/espn";
import { InjuriesFileSchema } from "../src/core/injuries";
import { PushLogFileSchema } from "../src/core/push-messages";
import type { PushPayload } from "../src/core/push-config";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const summaryText = read("./fixtures/espn-summary-2026-w9-401873037.json");
const parsed = parseScoreboard(JSON.parse(read("./fixtures/espn-scoreboard-2026-w9.json")), { fetchedAt: "2026-11-02T00:00:00Z" });
if (!parsed.ok) throw new Error(parsed.error);
const w9 = parsed.week;
// Nur das Thursday Night Game offen, damit der Wächter genau ein Summary lädt.
const weekW9 = {
  ...w9,
  games: w9.games.map((g) => (g.id === "401873037" ? g : { ...g, status: "final" as const })),
};

const INJ = "injuries/2026-2-09.json";
const TNF = "2026-11-06T01:15:00Z";
const SUB = JSON.stringify({ endpoint: "https://push.example/abc", expirationTime: null, keys: { p256dh: "p", auth: "a" } });
const ENV = { VAPID_PRIVATE_KEY: "priv", PUSH_SUBSCRIPTION: SUB, GITHUB_REF: "refs/heads/main" };

let dir: string;
let logs: string[];
let errors: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-push-"));
  await mkdir(join(dir, "weeks"));
  await mkdir(join(dir, "tips"));
  await writeFile(
    join(dir, "current.json"),
    JSON.stringify({ schemaVersion: 1, season: 2026, seasonType: 2, week: 9, weekFile: "weeks/2026-2-09.json", updatedAt: "2026-11-02T00:00:00Z" }),
  );
  await writeFile(join(dir, "weeks/2026-2-09.json"), JSON.stringify(weekW9));
  await writeFile(join(dir, "teams.json"), read("../data/teams.json"));
  await writeFile(join(dir, "tips/2026-2-09.json"), read("../data/tips/2026-2-09.json"));
  logs = [];
  errors = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fetchSummary = (mutate?: (s: any) => void): FetchFn => async (url) => {
  expect(url).toContain("summary?event=401873037");
  const s = JSON.parse(summaryText);
  mutate?.(s);
  return new Response(JSON.stringify(s), { status: 200 });
};
const watchDeps = (now: string, fetch: FetchFn) => ({
  dataDir: dir,
  now: () => now,
  fetch,
  log: (m: string) => logs.push(m),
  error: (m: string) => errors.push(m),
});
const readInj = async () => InjuriesFileSchema.parse(JSON.parse(await readFile(join(dir, INJ), "utf8")));

function setStatus(s: any, name: string, status: string) {
  for (const t of s.injuries) for (const i of t.injuries) if (i.athlete.displayName === name) i.status = status;
}

describe("jobs/watch.ts", () => {
  it("vor Donnerstag kein Grundstand, ab Donnerstag einmal, danach Änderungen", async () => {
    expect(await watch([], watchDeps("2026-11-04T12:00:00Z", fetchSummary()))).toBe(0);
    expect((await readInj()).baseline).toBeNull();

    expect(await watch([], watchDeps("2026-11-05T05:03:00Z", fetchSummary()))).toBe(0);
    const first = await readInj();
    expect(first.baseline?.takenAt).toBe("2026-11-05T05:03:00Z");

    const later = fetchSummary((s) => {
      setStatus(s, "Tyler Huntley", "Out");
      for (const t of s.injuries) t.injuries = t.injuries.filter((i: any) => i.athlete.displayName !== "Joe Fagnano");
    });
    expect(await watch([], watchDeps("2026-11-05T22:00:00Z", later))).toBe(0);
    const second = await readInj();
    expect(second.baseline).toEqual(first.baseline);
    expect(second.changes.map((c) => [c.name, c.kind, c.from, c.to])).toEqual([
      ["Tyler Huntley", "wechsel", "Questionable", "Out"],
      ["Joe Fagnano", "weg", "Out", null],
    ]);
  });

  it("schreibt nicht neu, wenn sich nur der Zeitstempel ändert", async () => {
    await watch([], watchDeps("2026-11-05T06:00:00Z", fetchSummary()));
    const before = await readFile(join(dir, INJ), "utf8");
    await watch([], watchDeps("2026-11-05T06:10:00Z", fetchSummary()));
    expect(await readFile(join(dir, INJ), "utf8")).toBe(before);
    expect(logs.at(-1)).toContain("unverändert");
  });

  it("Abruffehler ergibt Exit 1 und keinen Grundstand", async () => {
    const fail: FetchFn = async () => new Response("x", { status: 503 });
    expect(await watch([], watchDeps("2026-11-05T06:00:00Z", fail))).toBe(1);
    expect((await readInj()).baseline).toBeNull();
    expect(errors[0]).toContain("HTTP 503");
  });

  it("kaputte Ausfall Datei wird nicht überschrieben", async () => {
    await mkdir(join(dir, "injuries"));
    await writeFile(join(dir, INJ), "{kaputt");
    expect(await watch([], watchDeps("2026-11-05T06:00:00Z", fetchSummary()))).toBe(1);
    expect(await readFile(join(dir, INJ), "utf8")).toBe("{kaputt");
  });
});

describe("jobs/push.ts", () => {
  const sentPayloads: PushPayload[] = [];
  const okSend: SendFn = async (_s, p) => {
    sentPayloads.push(p);
  };
  beforeEach(() => {
    sentPayloads.length = 0;
  });
  const pushDeps = (now: string, env: Record<string, string | undefined>, send: SendFn = okSend) => ({
    dataDir: dir,
    now: () => now,
    env,
    send,
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  });
  const logPath = () => join(dir, "push-log.json");
  const exists = async (p: string) => readFile(p).then(() => true, () => false);
  const at30 = "2026-11-06T00:45:00Z";

  it("fehlende Secrets ergeben Exit 0 und kein push-log", async () => {
    expect(await push([], pushDeps(at30, {}))).toBe(0);
    expect(sentPayloads).toEqual([]);
    expect(await exists(logPath())).toBe(false);
    expect(logs.join("\n")).toContain("Secrets VAPID_PRIVATE_KEY oder PUSH_SUBSCRIPTION fehlen");
  });

  it("sendet Tippliste und Slot mit Tippänderung und Ausfall, danach nichts doppelt", async () => {
    await watch([], watchDeps("2026-11-05T06:00:00Z", fetchSummary()));
    await watch([], watchDeps("2026-11-06T00:30:00Z", fetchSummary((s) => setStatus(s, "Tyler Huntley", "Out"))));
    const tipsPath = join(dir, "tips/2026-2-09.json");
    const tips = JSON.parse(await readFile(tipsPath, "utf8"));
    const tnf = tips.tips.find((t: any) => t.gameId === "401873037");
    Object.assign(tnf, { firstPickTeamId: "30", pickTeamId: "33", changedSinceFirst: true });
    await writeFile(tipsPath, JSON.stringify(tips));

    expect(await push([], pushDeps(at30, ENV))).toBe(0);
    expect(sentPayloads.map((p) => p.title)).toEqual(["Tippliste W9 bereit", "Tippschluss in 30 min"]);
    expect(sentPayloads[1]?.body).toBe("JAX@BAL. Tipp JAX>BAL, BAL T.Huntley QB Q>O");
    const log = PushLogFileSchema.parse(JSON.parse(await readFile(logPath(), "utf8")));
    expect(log.entries.map((e) => e.key)).toEqual(["tips-ready:2026-2-9", "slot:2026-11-06T02:15+01:00"]);

    sentPayloads.length = 0;
    expect(await push([], pushDeps("2026-11-06T00:55:00Z", ENV))).toBe(0);
    expect(sentPayloads).toEqual([]);
    expect(logs.at(-1)).toBe("Keine Meldung fällig.");
  });

  it("410 ergibt Exit 1 mit klarer Meldung und push-log bleibt leer", async () => {
    const gone: SendFn = async () => {
      throw Object.assign(new Error("Received unexpected response code"), { statusCode: 410 });
    };
    expect(await push([], pushDeps(at30, ENV, gone))).toBe(1);
    expect(errors.join("\n")).toContain(EXPIRED_MESSAGE);
    expect(await exists(logPath())).toBe(false);
  });

  it("404 gilt ebenfalls als abgelaufen", async () => {
    const missing: SendFn = async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    };
    expect(await push(["--test"], pushDeps(at30, ENV, missing))).toBe(1);
    expect(errors.join("\n")).toContain(EXPIRED_MESSAGE);
  });

  it("anderer Fehler ergibt Exit 1, nur erfolgreiche Meldungen landen im Log", async () => {
    const flaky: SendFn = async (_s, p) => {
      if (p.title.startsWith("Tippschluss")) throw Object.assign(new Error("Server kaputt"), { statusCode: 500 });
      sentPayloads.push(p);
    };
    expect(await push([], pushDeps(at30, ENV, flaky))).toBe(1);
    const log = PushLogFileSchema.parse(JSON.parse(await readFile(logPath(), "utf8")));
    expect(log.entries.map((e) => e.key)).toEqual(["tips-ready:2026-2-9"]);
    expect(errors.join("\n")).toContain("HTTP 500");
  });

  it("Testnachricht ohne Log Eintrag", async () => {
    expect(await push(["--test"], pushDeps(at30, ENV))).toBe(0);
    expect(sentPayloads).toEqual([expect.objectContaining({ title: "Test aus GitHub Actions" })]);
    expect(await exists(logPath())).toBe(false);
  });

  it("Testnachricht ohne Secrets ergibt Exit 0", async () => {
    expect(await push(["--test"], pushDeps(at30, {}))).toBe(0);
    expect(sentPayloads).toEqual([]);
  });

  it("ungültige Anmeldung ergibt Exit 1 ohne Fehlerdetails", async () => {
    expect(await push([], pushDeps(at30, { ...ENV, PUSH_SUBSCRIPTION: '{"endpoint": geheim' }))).toBe(1);
    expect(errors).toEqual(["PUSH_SUBSCRIPTION ist kein gültiges Anmelde JSON. Im Onboarding kopieren und Secret ersetzen."]);
  });

  it("auf anderen Branches kein echter Versand, Testnachricht schon", async () => {
    const branch = { ...ENV, GITHUB_REF: "refs/heads/claude/x" };
    expect(await push([], pushDeps(at30, branch))).toBe(0);
    expect(sentPayloads).toEqual([]);
    expect(await exists(logPath())).toBe(false);
    expect(logs.at(-1)).toContain("Kein Versand auf refs/heads/claude/x");
    expect(await push(["--test"], pushDeps(at30, branch))).toBe(0);
    expect(sentPayloads.map((p) => p.title)).toEqual(["Test aus GitHub Actions"]);
  });

  it("TTL wird an den Versand übergeben", async () => {
    const ttls: number[] = [];
    const rec: SendFn = async (_s, _p, _v, ttl) => {
      ttls.push(ttl);
    };
    expect(await push([], pushDeps(at30, ENV, rec))).toBe(0);
    expect(ttls).toEqual([6 * 3600, 30 * 60]);
  });

  it("ausserhalb des Fensters nur die Tippliste", async () => {
    expect(await push([], pushDeps(minus(TNF, 61), ENV))).toBe(0);
    expect(sentPayloads.map((p) => p.title)).toEqual(["Tippliste W9 bereit"]);
  });
});

function minus(iso: string, min: number): string {
  return new Date(Date.parse(iso) - min * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
