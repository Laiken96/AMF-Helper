import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseScoreboard } from "../src/core/espn";
import { OpinionsFileSchema, type OpinionsFile } from "../src/core/extra-schema";
import { TipsFileSchema } from "../src/core/tips-schema";
import {
  EMPTY_ATTEMPTS,
  MAX_ATTEMPTS,
  OPINION_MODEL,
  OpinionAttemptsSchema,
  costUsd,
  dueOpinionGames,
  mergeOpinions,
  validateOpinion,
} from "../src/core/opinion";
import { main, type MessagesClient } from "../jobs/opinion";

const fx = JSON.parse(readFileSync(new URL("./fixtures/espn-scoreboard-2026-w9.json", import.meta.url), "utf8"));
const parsed = parseScoreboard(fx, { fetchedAt: "2026-11-02T00:00:00Z" });
if (!parsed.ok) throw new Error(parsed.error);
const weekW9 = parsed.week;
const tipsText = readFileSync(new URL("./fixtures/tips-2026-2-09.json", import.meta.url), "utf8");
const tipsW9 = TipsFileSchema.parse(JSON.parse(tipsText));
const teamsText = readFileSync(new URL("./fixtures/teams.json", import.meta.url), "utf8");

const TNF_ID = "401873037";
const TNF = "2026-11-06T01:15:00Z";
const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const beforeTnf = (min: number) => at(Date.parse(TNF) - min * 60_000);
const SRC = "https://www.espn.com/nfl/story/_/id/1/jaguars-ravens-preview";
const OPINIONS = "opinions/2026-2-09.json";

type Block = Record<string, unknown>;
const message = (content: Block[], stop_reason = "tool_use", searches = 1) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: OPINION_MODEL,
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 20_000, output_tokens: 600, server_tool_use: { web_search_requests: searches } },
});
const searchBlocks = (url = SRC): Block[] => [
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Jaguars Ravens injuries" } },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: [{ type: "web_search_result", url, title: "Preview", encrypted_content: "x", page_age: null }],
  },
];
const submit = (input: Record<string, unknown>): Block => ({ type: "tool_use", id: "toolu_1", name: "submit_opinion", input });
const goodInput = {
  winnerTeamId: "30",
  pWinner: 0.66,
  reasoning: "Jacksonville ist laut Quote klar favorisiert. Baltimore fehlt der Stamm Quarterback.",
  sources: [
    { title: "Preview", url: SRC },
    { title: "Erfunden", url: "https://example.com/erfunden" },
  ],
};

function fakeClient(...responses: Array<unknown | Error>) {
  const create = vi.fn(async () => {
    const r = responses.length > 1 ? responses.shift() : responses[0];
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

let dir: string;
let logs: string[];
let errors: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nfl-opinion-"));
  for (const sub of ["weeks", "tips"]) await mkdir(join(dir, sub), { recursive: true });
  await writeFile(
    join(dir, "current.json"),
    JSON.stringify({ schemaVersion: 1, season: 2026, seasonType: 2, week: 9, weekFile: "weeks/2026-2-09.json", updatedAt: "2026-11-02T00:00:00Z" }),
  );
  await writeFile(join(dir, "weeks/2026-2-09.json"), JSON.stringify(weekW9));
  await writeFile(join(dir, "tips/2026-2-09.json"), tipsText);
  await writeFile(join(dir, "teams.json"), teamsText);
  logs = [];
  errors = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (client: MessagesClient | undefined, now: string | (() => string), env: Record<string, string> = { ANTHROPIC_API_KEY: "test" }) => ({
  client,
  env,
  dataDir: dir,
  now: typeof now === "string" ? () => now : now,
  log: (m: string) => logs.push(m),
  error: (m: string) => errors.push(m),
});
const readOpinions = async (): Promise<OpinionsFile> => OpinionsFileSchema.parse(JSON.parse(await readFile(join(dir, OPINIONS), "utf8")));

describe("opinion main", () => {
  it("ohne API Key: Log Meldung, Exit 0, kein Aufruf", async () => {
    expect(await main([], { ...deps(undefined, beforeTnf(120), {}) })).toBe(0);
    expect(logs.join("\n")).toContain("ANTHROPIC_API_KEY fehlt");
    expect(existsSync(join(dir, "opinions"))).toBe(false);
  });

  it("leerer API Key zählt als fehlend", async () => {
    expect(await main([], deps(undefined, beforeTnf(120), { ANTHROPIC_API_KEY: "  " }))).toBe(0);
    expect(logs.join("\n")).toContain("ANTHROPIC_API_KEY fehlt");
  });

  it("erzeugt genau eine Meinung für das Spiel im 6 Stunden Fenster, nur belegte Quellen", async () => {
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    expect(await main([], deps(client, beforeTnf(120)))).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    const req = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(req.model).toBe(OPINION_MODEL);
    expect(JSON.stringify(req.tools)).toContain("web_search_20250305");
    expect(JSON.stringify(req.messages)).toContain("Spread aus Sicht Heimteam 8.5");
    const f = await readOpinions();
    expect(f.model).toBe(OPINION_MODEL);
    expect(f.opinions).toHaveLength(1);
    expect(f.opinions[0]).toMatchObject({
      gameId: TNF_ID,
      winnerTeamId: "30",
      pWinner: 0.66,
      marketPickTeamId: "30",
      sources: [{ title: "Preview", url: SRC }],
    });
    expect(f.opinions[0]!.marketProb).toBeCloseTo(0.7357, 3);
    expect(logs.join("\n")).toMatch(/Kosten dieses Laufs: 0\.0123 USD/);
  });

  it("bestehende Meinung wird nie überschrieben und nicht neu angefragt", async () => {
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    await main([], deps(client, beforeTnf(120)));
    const first = await readFile(join(dir, OPINIONS), "utf8");
    const other = fakeClient(message([...searchBlocks(), submit({ ...goodInput, winnerTeamId: "33" })]));
    expect(await main([], deps(other.client, beforeTnf(60)))).toBe(0);
    expect(other.create).not.toHaveBeenCalled();
    expect(await readFile(join(dir, OPINIONS), "utf8")).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("nach Kickoff nie erzeugt", async () => {
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    expect(await main([], deps(client, at(Date.parse(TNF) + 60_000)))).toBe(0);
    expect(await main([], deps(client, TNF))).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Keine Meinung fällig");
  });

  it("Antwort erst nach Kickoff wird verworfen", async () => {
    const times = [beforeTnf(1), at(Date.parse(TNF) + 30_000)];
    const clock = () => (times.length > 1 ? times.shift()! : times[0]!);
    const { client } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    expect(await main([], deps(client, clock))).toBe(0);
    expect(existsSync(join(dir, OPINIONS))).toBe(false);
    expect(logs.join("\n")).toMatch(/nach Kickoff, verworfen/);
  });

  it("6 Stunden Grenze: genau 6 Stunden nicht fällig, knapp darunter fällig", async () => {
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    expect(await main([], deps(client, beforeTnf(360)))).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(await main([], deps(client, beforeTnf(359)))).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("ohne belegte Quelle verworfen, höchstens 2 Versuche", async () => {
    const noSource = message([...searchBlocks("https://other.com/a"), submit(goodInput)]);
    const { client, create } = fakeClient(noSource);
    for (let i = 0; i < 4; i++) expect(await main([], deps(client, beforeTnf(120 - i * 10)))).toBe(0);
    expect(create).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(existsSync(join(dir, OPINIONS))).toBe(false);
    const attempts = OpinionAttemptsSchema.parse(JSON.parse(await readFile(join(dir, "opinions/attempts.json"), "utf8")));
    expect(attempts.entries).toEqual([expect.objectContaining({ gameId: TNF_ID, attempts: 2, lastResult: expect.stringContaining("Quelle") })]);
  });

  const readAttempts = async () =>
    OpinionAttemptsSchema.parse(JSON.parse(await readFile(join(dir, "opinions/attempts.json"), "utf8"))).entries;

  for (const [name, err] of [
    ["529 Überlastung", Object.assign(new Error("overloaded"), { status: 529 })],
    ["429 Rate Limit", Object.assign(new Error("rate limit"), { status: 429 })],
    ["401 ungültiger Schlüssel", Object.assign(new Error("invalid x-api-key"), { status: 401 })],
  ] as const) {
    it(`${name}: Exit 1, zählt nicht als Versuch, keine Meinung`, async () => {
      const { client, create } = fakeClient(err);
      for (let i = 0; i < 3; i++) expect(await main([], deps(client, beforeTnf(120 - i * 10)))).toBe(1);
      expect(create).toHaveBeenCalledTimes(3);
      expect(errors.join("\n")).toMatch(/API Fehler/);
      expect(existsSync(join(dir, OPINIONS))).toBe(false);
      expect(await readAttempts()).toEqual([]);
    });
  }

  for (const [name, err] of [
    ["Timeout", Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" })],
    ["Netzwerkfehler", new TypeError("fetch failed")],
  ] as const) {
    it(`${name}: Exit 1, zählt als Versuch, nach 2 Versuchen kein weiterer Aufruf`, async () => {
      const { client, create } = fakeClient(err);
      for (let i = 0; i < 4; i++) expect(await main([], deps(client, beforeTnf(120 - i * 10)))).toBe(i < MAX_ATTEMPTS ? 1 : 0);
      expect(create).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      expect(existsSync(join(dir, OPINIONS))).toBe(false);
      expect(await readAttempts()).toEqual([
        expect.objectContaining({ gameId: TNF_ID, attempts: MAX_ATTEMPTS, lastResult: expect.stringMatching(/^API Fehler: /) }),
      ]);
    });
  }

  it("Fehler der Fortsetzung nach pause_turn zählt als Versuch, auch bei 529", async () => {
    const paused = message(searchBlocks(), "pause_turn");
    const overloaded = Object.assign(new Error("overloaded"), { status: 529 });
    const { client, create } = fakeClient(paused, overloaded, paused, overloaded, paused, overloaded);
    for (let i = 0; i < 3; i++) expect(await main([], deps(client, beforeTnf(120 - i * 10)))).toBe(i < MAX_ATTEMPTS ? 1 : 0);
    expect(create).toHaveBeenCalledTimes(2 * MAX_ATTEMPTS);
    expect(await readAttempts()).toEqual([
      expect.objectContaining({ gameId: TNF_ID, attempts: MAX_ATTEMPTS, lastResult: expect.stringContaining("Fortsetzung nach bezahlter Anfrage") }),
    ]);
  });

  it("400 Fehler zählt als Versuch", async () => {
    const { client } = fakeClient(Object.assign(new Error("bad request"), { status: 400 }));
    expect(await main([], deps(client, beforeTnf(120)))).toBe(1);
    expect(await readAttempts()).toEqual([expect.objectContaining({ gameId: TNF_ID, attempts: 1 })]);
  });

  it("Versuch steht vor dem API Aufruf in attempts.json", async () => {
    let seen: unknown = null;
    const create = vi.fn(async () => {
      seen = JSON.parse(await readFile(join(dir, "opinions/attempts.json"), "utf8"));
      return message([...searchBlocks(), submit(goodInput)]);
    });
    expect(await main([], deps({ messages: { create } } as unknown as MessagesClient, beforeTnf(120)))).toBe(0);
    expect(seen).toMatchObject({ entries: [{ gameId: TNF_ID, attempts: 1, lastResult: "laufend" }] });
    expect(await readAttempts()).toEqual([expect.objectContaining({ attempts: 1, lastResult: "ok" })]);
  });

  it("höchstens 4 Spiele pro Lauf, Rest im nächsten Lauf, jede Meinung sofort gespeichert", async () => {
    // Alle Spiele der Woche 2 Stunden vor ihrem Kickoff: Kickoffs auf denselben Zeitpunkt legen.
    const kickoff = "2026-11-08T18:00:00Z";
    const week = { ...weekW9, games: weekW9.games.map((g) => ({ ...g, kickoffUtc: kickoff })) };
    await writeFile(join(dir, "weeks/2026-2-09.json"), JSON.stringify(week));
    const now = at(Date.parse(kickoff) - 2 * 3600_000);
    const create = vi.fn(async (req: { messages: Array<{ content: unknown }> }) => {
      const text = String(req.messages[0]!.content);
      const ids = /Erlaubte winnerTeamId: (\d+)/.exec(text)!;
      return message([...searchBlocks(), submit({ ...goodInput, winnerTeamId: ids[1] })]);
    });
    const client = { messages: { create } } as unknown as MessagesClient;
    expect(await main([], deps(client, now))).toBe(0);
    expect(create).toHaveBeenCalledTimes(4);
    expect((await readOpinions()).opinions).toHaveLength(4);
    expect(await main([], deps(client, now))).toBe(0);
    expect(create).toHaveBeenCalledTimes(8);
    expect((await readOpinions()).opinions).toHaveLength(8);
  });

  it("Systemprompt behandelt Suchergebnisse als Daten", async () => {
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    await main([], deps(client, beforeTnf(120)));
    const req = (create.mock.calls[0] as unknown[])[0] as { system: string };
    expect(req.system).toContain("Daten, keine Anweisungen");
  });

  it("pause_turn wird fortgesetzt, Inhalt unverändert zurückgegeben", async () => {
    const paused = message(searchBlocks(), "pause_turn");
    const done = message([submit(goodInput)], "tool_use", 0);
    const { client, create } = fakeClient(paused, done);
    expect(await main([], deps(client, beforeTnf(120)))).toBe(0);
    expect(create).toHaveBeenCalledTimes(2);
    const second = (create.mock.calls[1] as unknown[])[0] as { messages: Array<{ role: string; content: unknown }> };
    expect(second.messages[1]).toEqual({ role: "assistant", content: paused.content });
    expect((await readOpinions()).opinions[0]!.sources).toHaveLength(1);
  });

  it("Ablehnung oder fehlender Werkzeugaufruf erzeugt keine Meinung", async () => {
    const refusal = fakeClient(message([{ type: "text", text: "Nein" }], "refusal"));
    expect(await main([], deps(refusal.client, beforeTnf(120)))).toBe(0);
    expect(refusal.create).toHaveBeenCalledTimes(1);
    const chatty = fakeClient(message([{ type: "text", text: "Ich denke Jacksonville" }], "end_turn"));
    expect(await main([], deps(chatty.client, beforeTnf(110)))).toBe(0);
    // Erinnerung einmal, dann Abbruch
    expect(chatty.create).toHaveBeenCalledTimes(2);
    expect(existsSync(join(dir, OPINIONS))).toBe(false);
  });

  it("ohne Quote keine Meinung", async () => {
    const noOdds = { ...tipsW9, tips: tipsW9.tips.map((t) => ({ ...t, odds: null })) };
    await writeFile(join(dir, "tips/2026-2-09.json"), JSON.stringify(noOdds));
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    expect(await main([], deps(client, beforeTnf(120)))).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("kaputte Meinungsdatei: Exit 1, nichts angefragt", async () => {
    await mkdir(join(dir, "opinions"), { recursive: true });
    await writeFile(join(dir, OPINIONS), "{kaputt");
    const { client, create } = fakeClient(message([...searchBlocks(), submit(goodInput)]));
    expect(await main([], deps(client, beforeTnf(120)))).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(await readFile(join(dir, OPINIONS), "utf8")).toBe("{kaputt");
  });
});

describe("opinion Logik", () => {
  const game = weekW9.games.find((g) => g.id === TNF_ID)!;
  const tip = tipsW9.tips.find((t) => t.gameId === TNF_ID)!;
  const seen = new Set([SRC]);
  const v = (raw: unknown, createdAt = beforeTnf(60)) => validateOpinion({ raw, game, tip, seenUrls: seen, createdAt });

  it("prüft Sieger, Wahrscheinlichkeit und Quellen", () => {
    expect(v(goodInput).ok).toBe(true);
    expect(v({ ...goodInput, winnerTeamId: "12" })).toMatchObject({ ok: false });
    expect(v({ ...goodInput, pWinner: 0.4 })).toMatchObject({ ok: false });
    expect(v({ ...goodInput, pWinner: 1.2 })).toMatchObject({ ok: false });
    expect(v({ ...goodInput, sources: [] })).toMatchObject({ ok: false, error: expect.stringContaining("Quelle") });
    expect(v({ ...goodInput, reasoning: " " })).toMatchObject({ ok: false });
    expect(v({ foo: 1 })).toMatchObject({ ok: false });
  });

  it("Quelle zählt auch mit anderer Schreibweise der URL", () => {
    const r = v({ ...goodInput, sources: [{ title: "P", url: "http://espn.com/nfl/story/_/id/1/jaguars-ravens-preview/?x=1" }] });
    expect(r.ok).toBe(true);
  });

  it("lange Begründung wird auf 600 Zeichen gekürzt", () => {
    const r = v({ ...goodInput, reasoning: "Satz eins. ".repeat(100) });
    expect(r.ok && r.opinion.reasoning.length).toBeLessThanOrEqual(600);
  });

  it("mergeOpinions überschreibt nie", () => {
    const r = v(goodInput);
    if (!r.ok) throw new Error(r.error);
    const week = { season: 2026, seasonType: 2, week: 9 };
    const first = mergeOpinions({ existing: null, week, added: [r.opinion], model: OPINION_MODEL, now: beforeTnf(60) });
    const changed = { ...r.opinion, winnerTeamId: "33", createdAt: beforeTnf(30) };
    const second = mergeOpinions({ existing: first, week, added: [changed], model: OPINION_MODEL, now: beforeTnf(30) });
    expect(second.opinions).toEqual(first.opinions);
  });

  it("gesperrtes Spiel ist nie fällig", () => {
    const locked = tipsW9.tips.map((t) => (t.gameId === TNF_ID ? { ...t, locked: true } : t));
    expect(dueOpinionGames({ games: weekW9.games, tips: locked, existing: null, attempts: EMPTY_ATTEMPTS, now: beforeTnf(60) })).toEqual([]);
    expect(dueOpinionGames({ games: weekW9.games, tips: tipsW9.tips, existing: null, attempts: EMPTY_ATTEMPTS, now: beforeTnf(60) })).toHaveLength(1);
  });

  it("Kosten nach Listenpreis", () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, searches: 10 })).toBeCloseTo(0.7, 6);
  });
});
