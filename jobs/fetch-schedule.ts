// Datenjob Spielplan: holt das ESPN Scoreboard und schreibt data/teams.json, data/weeks/..., data/current.json
// und data/settings.json. Bei Fehler bleiben die bestehenden Dateien unverändert und der Exit Code ist 1.
// Ohne Argumente holt der Job in der Regular Season zusätzlich die nächsten 2 Wochen (D042), mit denselben
// Schutzregeln (D019) und ohne current.json anzupassen. Ein Fehler dort lässt die aktuelle Woche gültig.
// Aufruf: npm run job:schedule [-- --season 2026 --type 2 --week 8]
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { scoreboardUrl } from "../src/core/espn";
import { weekFilePath, type WeekFile } from "../src/core/schema";
import { REGULAR_SEASON_WEEKS } from "../src/core/tips";
import {
  FETCH_TIMEOUT_MS,
  USER_AGENT,
  buildOutputs,
  parseCliArgs,
  readExisting,
  writeFiles,
} from "./schedule-lib";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface MainDeps {
  fetch?: FetchFn;
  dataDir?: string;
  now?: () => string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

export async function fetchJson(url: string, fetchFn: FetchFn = fetch): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Antwort ist kein JSON (${text.length} Zeichen)`);
  }
}

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Führt den Job aus und liefert den Exit Code. Schreibt nur, wenn alles gültig ist. */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();

  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    error(`Ungültige Argumente. ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const explicit = args.season !== undefined || args.seasonType !== undefined || args.week !== undefined;
  const url = scoreboardUrl(args);
  log(`Hole ${url}`);

  let raw: unknown;
  try {
    raw = await fetchJson(url, deps.fetch);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    error(`Fehler beim Abruf, bestehende Dateien bleiben unverändert. ${msg}`);
    return 1;
  }

  // Erst parsen, um den Pfad der Woche zu kennen, dann mit bestehenden Dateien vergleichen.
  const probe = buildOutputs({ raw, now, updateCurrent: false, existing: {} });
  if (!probe.ok) {
    error(`Schemafehler, bestehende Dateien bleiben unverändert.\n${probe.error}`);
    return 1;
  }
  const w = probe.week;
  const existing = await readExisting(dataDir, weekFilePath(w.season, w.seasonType, w.week));
  const result = buildOutputs({ raw, now, updateCurrent: !explicit, allowShrink: explicit, existing });
  if (!result.ok) {
    error(`Abgelehnt, bestehende Dateien bleiben unverändert.\n${result.error}`);
    return 1;
  }

  await writeFiles(dataDir, result.files);
  log(`Saison ${w.season} Typ ${w.seasonType} Woche ${w.week}: ${w.games.length} Spiele, ${w.byeTeamIds.length} Bye Teams`);
  for (const f of result.files) log(`  geschrieben data/${f.path}`);
  for (const p of result.unchanged) log(`  unverändert data/${p}`);
  if (explicit) {
    log("  current.json nicht angepasst, da Woche explizit gewählt");
    return 0;
  }

  let exit = 0;
  for (const next of upcomingWeeks(w)) {
    if ((await fetchUpcomingWeek(next, { dataDir, now, log, error, fetch: deps.fetch })) !== 0) exit = 1;
  }
  return exit;
}

/** Anzahl kommender Wochen, die der Spielplan Job zusätzlich holt. */
export const UPCOMING_WEEKS = 2;

/** Die nächsten 2 Wochen der Regular Season nach der gegebenen Woche, nie über Woche 18 hinaus. */
export function upcomingWeeks(w: Pick<WeekFile, "season" | "seasonType" | "week">): Array<{ season: number; seasonType: number; week: number }> {
  if (w.seasonType !== 2) return [];
  const out = [];
  for (let i = 1; i <= UPCOMING_WEEKS && w.week + i <= REGULAR_SEASON_WEEKS; i++) {
    out.push({ season: w.season, seasonType: 2, week: w.week + i });
  }
  return out;
}

interface UpcomingCtx {
  dataDir: string;
  now: string;
  log: (msg: string) => void;
  error: (msg: string) => void;
  fetch?: FetchFn;
}

/** Holt eine kommende Woche. current.json bleibt, Spiele dürfen nicht verschwinden (D019). */
async function fetchUpcomingWeek(
  k: { season: number; seasonType: number; week: number },
  ctx: UpcomingCtx,
): Promise<number> {
  const label = `${k.season}-${k.seasonType}-${k.week}`;
  const url = scoreboardUrl(k);
  ctx.log(`Hole kommende Woche ${url}`);
  let raw: unknown;
  try {
    raw = await fetchJson(url, ctx.fetch);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    ctx.error(`Woche ${label}: Fehler beim Abruf, bestehende Datei bleibt unverändert. ${msg}`);
    return 1;
  }
  const existing = await readExisting(ctx.dataDir, weekFilePath(k.season, k.seasonType, k.week));
  const result = buildOutputs({ raw, now: ctx.now, updateCurrent: false, allowShrink: false, existing });
  if (!result.ok) {
    ctx.error(`Woche ${label} abgelehnt, bestehende Datei bleibt unverändert.\n${result.error}`);
    return 1;
  }
  const got = result.week;
  if (got.season !== k.season || got.seasonType !== k.seasonType || got.week !== k.week) {
    ctx.error(`Woche ${label}: ESPN lieferte ${got.season}-${got.seasonType}-${got.week}, nichts geschrieben.`);
    return 1;
  }
  await writeFiles(ctx.dataDir, result.files);
  ctx.log(`Kommende Woche ${label}: ${got.games.length} Spiele`);
  for (const f of result.files) ctx.log(`  geschrieben data/${f.path}`);
  return 0;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler, bestehende Dateien bleiben unverändert.", err);
      process.exitCode = 1;
    },
  );
}
