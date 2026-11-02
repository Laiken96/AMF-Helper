// Datenjob Spielplan: holt das ESPN Scoreboard und schreibt data/teams.json, data/weeks/..., data/current.json
// und data/settings.json. Bei Fehler bleiben die bestehenden Dateien unverändert und der Exit Code ist 1.
// Ohne Argumente holt der Job zusätzlich die nächsten 2 Tippwochen (D042), auch über die Grenze zur Postseason,
// mit denselben Schutzregeln (D019) und ohne current.json anzupassen. Ein Fehler dort lässt die aktuelle Woche gültig.
// Ruhende Wochen (Preseason, Pro Bowl, Offseason, siehe season-calendar.ts) schreibt der Job ohne Argumente nicht:
// current.json bleibt auf der letzten Tippwoche, damit Tipps und Pushes ruhen. Deren Wochendatei frischt der Job
// weiter auf, bis alle Spiele final sind, damit die Bilanz den Endstand bekommt. Ruhetage pro Spiel aus den
// Wochendateien der zwei Tippwochen davor (D050).
// Aufruf: npm run job:schedule [-- --season 2026 --type 2 --week 8]
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { scoreboardUrl } from "../src/core/espn";
import { CurrentFileSchema, WeekFileSchema, weekFilePath, type WeekFile } from "../src/core/schema";
import { dormantReason, isTipWeek, nextTipWeeks } from "../src/core/season-calendar";
import {
  FETCH_TIMEOUT_MS,
  USER_AGENT,
  buildOutputs,
  parseCliArgs,
  readExisting,
  readJsonIfExists,
  readPreviousGames,
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
  const dormant = dormantReason(w);
  if (dormant !== null && !explicit) {
    log(`Saison ${w.season} Typ ${w.seasonType} Woche ${w.week}: ${dormant}, ruhende Woche ohne Tipps. current.json bleibt.`);
    let exit = 0;
    if ((await refreshCurrentWeek({ dataDir, now, log, error, fetch: deps.fetch })) !== 0) exit = 1;
    for (const next of upcomingWeeks(w)) {
      if ((await fetchUpcomingWeek(next, { dataDir, now, log, error, fetch: deps.fetch })) !== 0) exit = 1;
    }
    return exit;
  }
  const existing = await readExisting(dataDir, weekFilePath(w.season, w.seasonType, w.week));
  const previousGames = await readPreviousGames(dataDir, w);
  const result = buildOutputs({ raw, now, updateCurrent: !explicit, allowShrink: explicit, existing, previousGames });
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

/**
 * Die nächsten 2 Tippwochen nach der gegebenen Woche: Regular Week 18 gefolgt von Postseason Week 1 und 2,
 * Conference Woche gefolgt vom Super Bowl (ohne Pro Bowl), aus der Preseason Regular Week 1 und 2.
 * Nach dem Super Bowl keine. Auch build-tips.ts und opinion.ts nutzen diese Liste.
 */
export function upcomingWeeks(w: Pick<WeekFile, "season" | "seasonType" | "week">): Array<{ season: number; seasonType: number; week: number }> {
  return nextTipWeeks({ season: w.season, seasonType: w.seasonType, week: w.week }, UPCOMING_WEEKS);
}

interface UpcomingCtx {
  dataDir: string;
  now: string;
  log: (msg: string) => void;
  error: (msg: string) => void;
  fetch?: FetchFn;
}

/**
 * Holt eine kommende Woche. current.json bleibt, Spiele dürfen nicht verschwinden (D019).
 * Eine Woche ohne Spiele wird nicht geschrieben (Postseason vor der Ansetzung). Für Postseason Wochen gilt ein
 * Schemafehler als noch nicht angesetzt (ESPN liefert vor der Paarung Platzhalter), Exit 0 ohne Schreiben.
 */
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
  const previousGames = await readPreviousGames(ctx.dataDir, k);
  const result = buildOutputs({ raw, now: ctx.now, updateCurrent: false, allowShrink: false, existing, previousGames });
  if (!result.ok) {
    if (k.seasonType === 3 && existing.week === undefined) {
      ctx.log(`Woche ${label}: noch nicht angesetzt, nichts geschrieben. ${result.error.split("\n")[0]}`);
      return 0;
    }
    ctx.error(`Woche ${label} abgelehnt, bestehende Datei bleibt unverändert.\n${result.error}`);
    return 1;
  }
  const got = result.week;
  if (got.season !== k.season || got.seasonType !== k.seasonType || got.week !== k.week) {
    ctx.error(`Woche ${label}: ESPN lieferte ${got.season}-${got.seasonType}-${got.week}, nichts geschrieben.`);
    return 1;
  }
  if (got.games.length === 0) {
    ctx.log(`Woche ${label}: noch keine Spiele, nichts geschrieben.`);
    return 0;
  }
  const placeholder = got.games.find((g) => !isRealTeamId(g.homeId) || !isRealTeamId(g.awayId));
  if (placeholder) {
    ctx.log(`Woche ${label}: Paarung ${placeholder.id} noch offen, nichts geschrieben.`);
    return 0;
  }
  await writeFiles(ctx.dataDir, result.files);
  ctx.log(`Kommende Woche ${label}: ${got.games.length} Spiele`);
  for (const f of result.files) ctx.log(`  geschrieben data/${f.path}`);
  return 0;
}

/**
 * In einer ruhenden Woche bleibt current.json auf der letzten Tippwoche. Deren Wochendatei wird weiter
 * aufgefrischt, bis alle Spiele final oder abgesagt sind, damit der Endstand der Conference Woche oder des
 * Super Bowl in die Bilanz kommt. current.json selbst bleibt unverändert.
 */
async function refreshCurrentWeek(ctx: UpcomingCtx): Promise<number> {
  const cur = CurrentFileSchema.safeParse(await readJsonIfExists(join(ctx.dataDir, "current.json")));
  if (!cur.success || !isTipWeek(cur.data)) return 0;
  const k = { season: cur.data.season, seasonType: cur.data.seasonType, week: cur.data.week };
  const existing = WeekFileSchema.safeParse(await readJsonIfExists(join(ctx.dataDir, weekFilePath(k.season, k.seasonType, k.week))));
  if (!existing.success) return 0;
  if (existing.data.games.every((g) => g.status === "final" || g.status === "canceled")) return 0;
  ctx.log(`Woche ${k.season}-${k.seasonType}-${k.week} aus current.json noch nicht komplett final, frische sie auf.`);
  return fetchUpcomingWeek(k, ctx);
}

/** ESPN Team IDs sind positive ganze Zahlen. Platzhalter für offene Playoff Paarungen haben andere Werte. */
export function isRealTeamId(id: string): boolean {
  return /^[1-9]\d*$/.test(id);
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
