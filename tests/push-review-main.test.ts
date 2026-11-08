import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main as push, type SendFn } from "../jobs/push";
import { parseScoreboard } from "../src/core/espn";
import { PushLogFileSchema } from "../src/core/push-messages";
import type { PushPayload } from "../src/core/push-config";
import type { ReviewFile } from "../src/core/review-schema";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const parsed = parseScoreboard(JSON.parse(read("./fixtures/espn-scoreboard-2026-w9.json")), { fetchedAt: "2026-11-02T00:00:00Z" });
if (!parsed.ok) throw new Error(parsed.error);
const SUB = JSON.stringify({ endpoint: "https://push.example/abc", expirationTime: null, keys: { p256dh: "p", auth: "a" } });
const ENV = { VAPID_PRIVATE_KEY: "priv", PUSH_SUBSCRIPTION: SUB, GITHUB_REF: "refs/heads/main" };
// Dienstag nach Week 8, kein Slot im Fenster. Ohne Tippdatei Week 9 kommt nur die Bilanz.
const TUESDAY = "2026-11-03T10:00:00Z";

const review = (week: number, complete: boolean): ReviewFile => ({
  schemaVersion: 1,
  season: 2026,
  seasonType: 2,
  week,
  updatedAt: TUESDAY,
  complete,
  games: [],
  points: 1,
  tipped: 1,
  deviationNet: 0,
  tiebreakers: [{ gameId: "401873036", slot: "monday", predictedHome: 25, predictedAway: 22, actualHome: 27, actualAway: 20, diff: 4 }],
});

let dir: string;
let sent: PushPayload[];
let logs: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-push-review-"));
  await mkdir(join(dir, "weeks"));
  await mkdir(join(dir, "reviews"));
  await writeFile(
    join(dir, "current.json"),
    JSON.stringify({ schemaVersion: 1, season: 2026, seasonType: 2, week: 9, weekFile: "weeks/2026-2-09.json", updatedAt: TUESDAY }),
  );
  await writeFile(join(dir, "weeks/2026-2-09.json"), JSON.stringify(parsed.week));
  await writeFile(join(dir, "teams.json"), read("./fixtures/teams.json"));
  sent = [];
  logs = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const send: SendFn = async (_s, p) => {
  sent.push(p);
};
const deps = (now = TUESDAY) => ({ dataDir: dir, now: () => now, env: ENV, send, log: (m: string) => logs.push(m), error: () => {} });
const writeReviews = async (...rs: ReviewFile[]) => {
  for (const r of rs) await writeFile(join(dir, `reviews/2026-2-${String(r.week).padStart(2, "0")}.json`), JSON.stringify(r));
  await writeFile(
    join(dir, "reviews/index.json"),
    JSON.stringify(rs.map((r) => `reviews/2026-2-${String(r.week).padStart(2, "0")}.json`)),
  );
};

describe("push Bilanz bereit", () => {
  it("sendet einmal, sobald die Bilanz komplett ist", async () => {
    await writeReviews(review(8, false));
    expect(await push([], deps())).toBe(0);
    expect(sent).toEqual([]);

    await writeReviews(review(8, true));
    expect(await push([], deps())).toBe(0);
    expect(sent.map((p) => p.title)).toEqual(["Bilanz W8 bereit"]);
    expect(sent[0]?.body).toBe("App Punkte 1 von 1, Tiebreaker Abweichung MNF 4");
    const log = PushLogFileSchema.parse(JSON.parse(await readFile(join(dir, "push-log.json"), "utf8")));
    expect(log.entries.map((e) => e.key)).toEqual(["review-ready:2026-2-8"]);

    sent.length = 0;
    expect(await push([], deps("2026-11-03T10:10:00Z"))).toBe(0);
    expect(sent).toEqual([]);
  });

  it("neuer Zwischenstand Week 9 verdrängt die fällige Bilanz Week 8 nicht", async () => {
    await writeReviews(review(9, false), review(8, true));
    expect(await push([], deps())).toBe(0);
    expect(sent.map((p) => p.title)).toEqual(["Bilanz W8 bereit"]);
  });

  it("kaputte Bilanz blockiert die übrigen Meldungen nicht", async () => {
    await writeFile(join(dir, "reviews/index.json"), "[\"reviews/2026-2-08.json\"]");
    await writeFile(join(dir, "reviews/2026-2-08.json"), "{\"kaputt\": true}");
    expect(await push([], deps())).toBe(0);
    expect(logs.join("\n")).toContain("Bilanz ungültig");
  });
});
