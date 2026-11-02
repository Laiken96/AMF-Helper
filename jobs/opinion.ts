// KI Zweitmeinung im Schattenmodus (D040, D042): schreibt data/opinions/<saison>-<typ>-<ww>.json.
// Läuft im Push Workflow alle 10 Minuten. Pro Spiel genau eine Meinung, erzeugt im ersten Lauf, wenn der
// Kickoff weniger als 6 Stunden entfernt ist und eine Quote existiert. Danach nie überschrieben.
// Ohne Secret ANTHROPIC_API_KEY: nur Log Meldung, Exit 0. Kosten pro Lauf stehen im Log.
// Aufruf: npm run job:opinion
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { OpinionsFileSchema, opinionsFilePath, type OpinionsFile } from "../src/core/extra-schema";
import { CurrentFileSchema, TeamsFileSchema, WeekFileSchema, weekFilePath, type Team } from "../src/core/schema";
import { TipsFileSchema, tipsFilePath } from "../src/core/tips-schema";
import { InjuriesFileSchema, injuriesFilePath, type InjuriesFile } from "../src/core/injuries";
import {
  ATTEMPTS_PATH,
  EMPTY_ATTEMPTS,
  MAX_GAMES_PER_RUN,
  MAX_SEARCHES,
  OPINION_MODEL,
  OPINION_SYSTEM,
  OpinionAttemptsSchema,
  SUBMIT_OPINION_INPUT_SCHEMA,
  buildOpinionPrompt,
  costUsd,
  dueOpinionGames,
  mergeOpinions,
  recordAttempt,
  validateOpinion,
  type OpinionAttempts,
  type OpinionCandidate,
  type UsageTotals,
} from "../src/core/opinion";
import { DATA_DIR, upcomingWeeks, type MainDeps } from "./fetch-schedule";
import { toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

/** Nur der Teil des SDK Clients, den der Job braucht. Tests ersetzen ihn vollständig. */
export type MessagesClient = { messages: Pick<Anthropic["messages"], "create"> };

export interface OpinionDeps extends MainDeps {
  env?: Record<string, string | undefined>;
  client?: MessagesClient;
}

/** Höchstens 3 Anfragen pro Spiel: Erstantwort, Fortsetzung nach pause_turn, eine Erinnerung. */
export const MAX_REQUESTS_PER_GAME = 3;
export const MAX_TOKENS = 8000;

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES },
  {
    name: "submit_opinion",
    description: "Gibt die Zweitmeinung zum Spiel ab. Genau einmal aufrufen, am Ende.",
    strict: true,
    input_schema: SUBMIT_OPINION_INPUT_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
  },
];

/** 60 Sekunden pro Anfrage, höchstens 1 Wiederholung, damit ein Lauf nie lange hängt. */
export const CLIENT_TIMEOUT_MS = 60_000;
export const CLIENT_MAX_RETRIES = 1;

async function defaultClient(apiKey: string): Promise<MessagesClient> {
  const mod = await import("@anthropic-ai/sdk");
  return new mod.default({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: CLIENT_MAX_RETRIES });
}

/** URLs aus Suchergebnissen und Zitaten einer Antwort. Nur diese dürfen als Quelle stehen. */
export function collectUrls(content: readonly Anthropic.Messages.ContentBlock[], into: Set<string>): void {
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) into.add(r.url);
    }
    if (block.type === "text" && block.citations) {
      for (const c of block.citations) if (c.type === "web_search_result_location") into.add(c.url);
    }
  }
}

type AskResult =
  | { ok: true; raw: unknown; seenUrls: Set<string> }
  | { ok: false; error: string; apiError?: boolean; transient?: boolean };

/**
 * Rate Limit, Überlastung und Serverfehler (408, 429, 5xx) lehnt die API sofort ab, ohne Kosten. Ungültiger
 * oder gesperrter Schlüssel (401, 403) ist ein Konfigurationsfehler. Beides zählt nicht als Versuch.
 * Timeout und Netzfehler (ohne Status) zählen dagegen: die Anfrage kann bereits verarbeitet und bezahlt sein,
 * ohne Zählung würde MAX_ATTEMPTS nie greifen und jeder Lauf erneut Kosten erzeugen.
 */
export function isTransient(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

/**
 * Altlast vor dem Fix für 401 und 403: Einträge, deren letzter Fehler ein vorübergehender HTTP Status war
 * (Schlüssel, Überlastung), wurden fälschlich gezählt. Solche Einträge werden verworfen, damit das Spiel
 * erneut drankommt. Nur Einträge, die mit "API Fehler HTTP" beginnen: Timeouts ohne Status und Fehler
 * einer Fortsetzung nach bezahlter Anfrage bleiben gezählt.
 */
export function forgiveTransient(a: OpinionAttempts): OpinionAttempts {
  const entries = a.entries.filter((e) => {
    const m = /^API Fehler HTTP (\d{3})/.exec(e.lastResult);
    return !(m && isTransient(Number(m[1])));
  });
  return entries.length === a.entries.length ? a : { ...a, entries };
}

/** Fragt das Modell für ein Spiel. Gibt die Werkzeug Eingabe von submit_opinion zurück. */
async function askModel(client: MessagesClient, prompt: string, usage: UsageTotals): Promise<AskResult> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
  const seenUrls = new Set<string>();
  let reminded = false;
  for (let i = 0; i < MAX_REQUESTS_PER_GAME; i++) {
    let res: Anthropic.Messages.Message;
    try {
      res = await client.messages.create({
        model: OPINION_MODEL,
        max_tokens: MAX_TOKENS,
        system: OPINION_SYSTEM,
        tools: TOOLS,
        tool_choice: { type: "auto" },
        output_config: { effort: "medium" },
        messages,
      });
    } catch (err) {
      const raw = typeof err === "object" && err !== null && "status" in err ? (err as { status: unknown }).status : undefined;
      const status = typeof raw === "number" ? raw : undefined;
      // Nach einer erfolgreichen ersten Anfrage sind Kosten entstanden: jeder Fehler der Fortsetzung zählt.
      const prefix = i === 0 ? "" : "Fortsetzung nach bezahlter Anfrage, ";
      return {
        ok: false,
        error: `${prefix}API Fehler${status !== undefined ? ` HTTP ${status}` : ""}: ${describeError(err)}`,
        apiError: true,
        transient: i === 0 && isTransient(status),
      };
    }
    usage.inputTokens += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += res.usage.output_tokens;
    usage.searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    collectUrls(res.content, seenUrls);

    if (res.stop_reason === "refusal") return { ok: false, error: "Modell hat abgelehnt" };
    const submit = res.content.find((b) => b.type === "tool_use" && b.name === "submit_opinion");
    if (submit && submit.type === "tool_use") return { ok: true, raw: submit.input, seenUrls };
    if (res.stop_reason === "max_tokens") return { ok: false, error: "Antwort abgeschnitten (max_tokens)" };

    // Assistent Inhalt unverändert zurückgeben, auch Denk und Suchblöcke.
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    if (reminded) break;
    reminded = true;
    messages.push({ role: "user", content: "Bitte gib die Meinung jetzt mit submit_opinion ab." });
  }
  return { ok: false, error: "kein Aufruf von submit_opinion" };
}

interface WeekData {
  key: { season: number; seasonType: number; week: number };
  candidates: OpinionCandidate[];
  existing: OpinionsFile | null;
  injuries: InjuriesFile | null;
}

/** Führt den Job aus und liefert den Exit Code. */
export async function main(argv: readonly string[], deps: OpinionDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const clock = deps.now ?? nowUtc;
  const env = deps.env ?? process.env;

  if (argv.length > 0) {
    error(`Unbekanntes Argument: ${argv.join(" ")}`);
    return 1;
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey && !deps.client) {
    log("Secret ANTHROPIC_API_KEY fehlt, keine KI Zweitmeinung erzeugt.");
    return 0;
  }

  const now = clock();
  let weeks: WeekData[];
  let teams: Map<string, Team>;
  let attempts: OpinionAttempts;
  try {
    const current = CurrentFileSchema.parse(await readJsonStrict(join(dataDir, "current.json")));
    teams = new Map(TeamsFileSchema.parse(await readJsonStrict(join(dataDir, "teams.json"))).teams.map((t) => [t.id, t]));
    const attemptsRaw = await readJsonStrict(join(dataDir, ATTEMPTS_PATH));
    attempts = forgiveTransient(attemptsRaw === undefined ? EMPTY_ATTEMPTS : OpinionAttemptsSchema.parse(attemptsRaw));
    weeks = [];
    for (const key of [current, ...upcomingWeeks(current)]) {
      const { season, seasonType, week } = key;
      const weekRaw = await readJsonStrict(join(dataDir, weekFilePath(season, seasonType, week)));
      const tipsRaw = await readJsonStrict(join(dataDir, tipsFilePath(season, seasonType, week)));
      if (weekRaw === undefined || tipsRaw === undefined) continue;
      const games = WeekFileSchema.parse(weekRaw).games;
      const tips = TipsFileSchema.parse(tipsRaw).tips;
      const opRaw = await readJsonStrict(join(dataDir, opinionsFilePath(season, seasonType, week)));
      const existing = opRaw === undefined ? null : OpinionsFileSchema.parse(opRaw);
      const candidates = dueOpinionGames({ games, tips, existing, attempts, now });
      if (candidates.length === 0) continue;
      if (existing && existing.model !== OPINION_MODEL) {
        error(`Meinungsdatei ${season}-${seasonType}-${week} stammt von ${existing.model}, keine neuen Meinungen mit ${OPINION_MODEL}.`);
        continue;
      }
      let injuries: InjuriesFile | null = null;
      try {
        const injRaw = await readJsonStrict(join(dataDir, injuriesFilePath(season, seasonType, week)));
        if (injRaw !== undefined) injuries = InjuriesFileSchema.parse(injRaw);
      } catch (err) {
        log(`Ausfall Datei ${season}-${seasonType}-${week} ungültig, Meinung ohne Ausfälle. ${describeError(err)}`);
      }
      weeks.push({ key: { season, seasonType, week }, candidates, existing, injuries });
    }
  } catch (err) {
    // Ungültige Meinungsdatei landet auch hier: lieber keine neue Meinung als eine bestehende verlieren.
    error(`Daten fehlen oder sind ungültig, keine Meinung erzeugt. ${describeError(err)}`);
    return 1;
  }

  const total = weeks.reduce((n, w) => n + w.candidates.length, 0);
  if (total === 0) {
    log("Keine Meinung fällig.");
    return 0;
  }

  const client = deps.client ?? (await defaultClient(apiKey!));
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, searches: 0 };
  const saveAttempts = () => writeFiles(dataDir, [{ path: ATTEMPTS_PATH, content: toJson(attempts) }]);
  let budget = MAX_GAMES_PER_RUN;
  let exit = 0;
  let created = 0;
  outer: for (const w of weeks) {
    let existing = w.existing;
    for (const c of w.candidates) {
      if (budget-- <= 0) {
        log(`Obergrenze von ${MAX_GAMES_PER_RUN} Spielen pro Lauf erreicht, Rest im nächsten Lauf.`);
        break outer;
      }
      const label = `${w.key.season}-${w.key.seasonType}-${w.key.week} Spiel ${c.game.id}`;
      const prompt = buildOpinionPrompt({ game: c.game, tip: c.tip, teams, injuries: w.injuries });
      // Versuch vor dem Aufruf speichern: bricht der Lauf ab, zählt er trotzdem und kostet nicht doppelt.
      const before = attempts;
      attempts = recordAttempt(attempts, c.game.id, clock(), "laufend");
      await saveAttempts();
      const asked = await askModel(client, prompt, usage);
      const at = clock();
      if (!asked.ok) {
        error(`${label}: ${asked.error}`);
        if (asked.transient) {
          // Überlastung, Rate Limit oder Schlüssel: sofort abgelehnt, keine Kosten, zählt nicht als Versuch.
          attempts = before;
          exit = 1;
        } else {
          attempts = recordAttempt(before, c.game.id, at, asked.error);
          if (asked.apiError) exit = 1;
        }
        await saveAttempts();
        continue;
      }
      const v = validateOpinion({ raw: asked.raw, game: c.game, tip: c.tip, seenUrls: asked.seenUrls, createdAt: at });
      if (!v.ok) {
        log(`${label}: verworfen, ${v.error}`);
        attempts = recordAttempt(before, c.game.id, at, v.error);
        await saveAttempts();
        continue;
      }
      // Meinung sofort speichern, dann den Versuch als erledigt markieren.
      existing = mergeOpinions({ existing, week: w.key, added: [v.opinion], model: OPINION_MODEL, now: at });
      const path = opinionsFilePath(w.key.season, w.key.seasonType, w.key.week);
      await writeFiles(dataDir, [{ path, content: toJson(existing) }]);
      attempts = recordAttempt(before, c.game.id, at, "ok");
      await saveAttempts();
      created++;
      log(`${label}: Meinung ${v.opinion.winnerTeamId} ${v.opinion.pWinner}, ${v.opinion.sources.length} Quellen, geschrieben data/${path}`);
    }
  }
  log(
    `Kosten dieses Laufs: ${costUsd(usage).toFixed(4)} USD (${usage.inputTokens} Input Tokens, ` +
      `${usage.outputTokens} Output Tokens, ${usage.searches} Suchen, ${created} Meinungen, Modell ${OPINION_MODEL})`,
  );
  return exit;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler im Meinungs Job, bestehende Meinungen bleiben unverändert.", err);
      process.exitCode = 1;
    },
  );
}
