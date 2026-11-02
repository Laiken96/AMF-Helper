// Ausfall Wächter (D030): lädt das ESPN Summary je offenem Spiel der Woche und schreibt
// data/injuries/<saison>-<typ>-<woche>.json mit Grundstand, aktuellem Stand und Änderungen.
// Der Grundstand wird beim ersten vollständigen Lauf ab Donnerstag 00:00 New York gesetzt und nie überschrieben.
// Ohne Argumente gilt data/current.json, dazu die nächste Woche mit Wochendatei (D050). Push Meldungen
// zu Ausfällen liest jobs/push.ts nur für die aktuelle Woche.
// Aus demselben Summary kommt der ESPN FPI predictor nach data/fpi/<saison>-<typ>-<woche>.json (D050),
// nur für den Schattenvergleich, nie für den Tipp (D009).
// Mit --current nur die aktuelle Woche, mit --next nur die nächste. push.yml ruft beides getrennt auf, damit
// langsame Abrufe der nächsten Woche den Push Versand nicht verzögern.
// Aufruf: npm run job:watch [-- --season 2026 --type 2 --week 9] oder npm run job:watch -- --current | --next.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CurrentFileSchema, WeekFileSchema, weekFilePath } from "../src/core/schema";
import {
  InjuriesFileSchema,
  buildInjuriesFile,
  injuriesFilePath,
  keyPlayersFromSummary,
  parseSummary,
  sameInjuriesContent,
  summaryUrl,
  type InjuriesFile,
  type KeyPlayer,
} from "../src/core/injuries";
import { FpiFileSchema, buildFpiFile, fpiFilePath, fpiFromSummary, sameFpiContent, type FpiFile, type FpiProjection } from "../src/core/fpi";
import { DATA_DIR, fetchJson, upcomingWeeks, type MainDeps } from "./fetch-schedule";
import { parseCliArgs, toJson, writeFiles } from "./schedule-lib";

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Liest JSON. Fehlt die Datei, kommt undefined. Kaputtes JSON wirft, damit der Grundstand nie verloren geht. */
export async function readJsonStrict(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text);
}

export const describeError = (err: unknown): string =>
  err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);

interface WeekRef {
  season: number;
  seasonType: number;
  week: number;
}

interface WatchCtx {
  dataDir: string;
  now: string;
  log: (msg: string) => void;
  error: (msg: string) => void;
  fetch?: MainDeps["fetch"];
}

/**
 * Führt den Wächter aus und liefert den Exit Code. Schreibt nur bei inhaltlicher Änderung.
 * Ohne Argumente: aktuelle Woche aus current.json und die nächste Woche, falls deren Wochendatei existiert.
 * --current beschränkt auf die aktuelle, --next auf die nächste Woche.
 * Ein Fehler in einer Woche lässt die andere laufen, der Exit Code ist dann 1.
 */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  const keep = "Ausfall Datei bleibt unverändert.";

  const onlyCurrent = argv.includes("--current");
  const onlyNext = argv.includes("--next");
  let args;
  try {
    args = parseCliArgs(argv.filter((a) => a !== "--current" && a !== "--next"));
  } catch (err) {
    error(`Ungültige Argumente. ${describeError(err)}`);
    return 1;
  }
  const explicit = args.season !== undefined || args.seasonType !== undefined || args.week !== undefined;
  if ((onlyCurrent && onlyNext) || (explicit && (onlyCurrent || onlyNext))) {
    error("Ungültige Argumente. --current und --next schliessen sich gegenseitig und eine explizite Woche aus.");
    return 1;
  }
  let season = args.season;
  let seasonType = args.seasonType;
  let weekNo = args.week;
  if (season === undefined || seasonType === undefined || weekNo === undefined) {
    try {
      const current = CurrentFileSchema.parse(await readJsonStrict(join(dataDir, "current.json")));
      season ??= current.season;
      seasonType ??= current.seasonType;
      weekNo ??= current.week;
    } catch (err) {
      error(`data/current.json fehlt oder ist ungültig. ${keep}\n${describeError(err)}`);
      return 1;
    }
  }

  const ctx: WatchCtx = { dataDir, now, log, error, fetch: deps.fetch };
  const primary: WeekRef = { season, seasonType, week: weekNo };
  let exit = onlyNext ? 0 : await runWeek(primary, ctx);
  if (!explicit && !onlyCurrent) {
    const next = upcomingWeeks(primary)[0];
    if (next && existsSync(join(dataDir, weekFilePath(next.season, next.seasonType, next.week)))) {
      log(`Nächste Woche ${next.season}-${next.seasonType}-${next.week}`);
      if ((await runWeek(next, ctx)) !== 0) exit = 1;
    } else if (next) {
      log(`Nächste Woche ${next.season}-${next.seasonType}-${next.week} ohne Wochendatei, übersprungen.`);
    }
  }
  return exit;
}

/** Eine Woche: Summary je offenem Spiel, Ausfall Datei und FPI Datei. */
async function runWeek(ref: WeekRef, ctx: WatchCtx): Promise<number> {
  const { dataDir, now, log, error } = ctx;
  const { season, seasonType, week: weekNo } = ref;
  const keep = "Ausfall Datei bleibt unverändert.";

  const weekPath = weekFilePath(season, seasonType, weekNo);
  let week;
  try {
    week = WeekFileSchema.parse(await readJsonStrict(join(dataDir, weekPath)));
  } catch (err) {
    error(`data/${weekPath} fehlt oder ist ungültig. ${keep}\n${describeError(err)}`);
    return 1;
  }
  if (week.games.length === 0) {
    log(`Woche ${season}-${seasonType}-${weekNo} ohne Spiele, nichts zu tun.`);
    return 0;
  }

  const path = injuriesFilePath(season, seasonType, weekNo);
  let existing: InjuriesFile | null = null;
  try {
    const raw = await readJsonStrict(join(dataDir, path));
    if (raw !== undefined) existing = InjuriesFileSchema.parse(raw);
  } catch (err) {
    error(`Bestehende data/${path} ist ungültig, der Grundstand würde verloren gehen. ${keep}\n${describeError(err)}`);
    return 1;
  }

  // Nur offene Spiele laden. Begonnene und beendete Spiele behalten ihren letzten Stand.
  const open = week.games.filter((g) => g.status === "scheduled");
  const fetched = new Map<string, KeyPlayer[]>();
  const fpiFetched = new Map<string, FpiProjection>();
  let failed = 0;
  for (const g of open) {
    const url = summaryUrl(g.id);
    try {
      const raw = await fetchJson(url, ctx.fetch);
      // FPI unabhängig vom Ausfall Schema, ein fehlender predictor ist kein Fehler.
      const fpi = fpiFromSummary(raw, g);
      if (fpi) fpiFetched.set(g.id, fpi);
      const parsed = parseSummary(raw);
      if (!parsed.ok) throw new Error(`Schemafehler\n${parsed.error}`);
      fetched.set(g.id, keyPlayersFromSummary(parsed.summary));
    } catch (err) {
      failed++;
      error(`Spiel ${g.id}: Abruf fehlgeschlagen, alter Stand bleibt. ${describeError(err)}`);
    }
  }

  const next = buildInjuriesFile({
    season,
    seasonType,
    week: weekNo,
    games: week.games,
    fetched,
    complete: failed === 0,
    existing,
    now,
  });

  log(
    `Woche ${season}-${seasonType}-${weekNo}: ${open.length} offene Spiele, ${fetched.size} geladen, ` +
      `Grundstand ${next.baseline ? `seit ${next.baseline.takenAt}` : `ab ${next.baselineFrom}`}, ${next.changes.length} Änderungen`,
  );
  if (!existing?.baseline && next.baseline) log("  Grundstand gesetzt");
  if (!next.baseline && failed > 0 && Date.parse(now) >= Date.parse(next.baselineFrom)) {
    log("  Grundstand nicht gesetzt, da nicht alle Spiele geladen wurden");
  }

  if (existing && sameInjuriesContent(existing, next)) log(`  unverändert data/${path}`);
  else {
    await writeFiles(dataDir, [{ path, content: toJson(next) }]);
    log(`  geschrieben data/${path}`);
  }

  const fpiOk = await writeFpi(ref, week.games, fpiFetched, ctx);
  return failed > 0 || !fpiOk ? 1 : 0;
}

/** FPI Datei der Woche. Eine kaputte bestehende Datei bleibt unverändert, der Lauf wird rot. */
async function writeFpi(
  ref: WeekRef,
  games: Parameters<typeof buildFpiFile>[0]["games"],
  fetched: ReadonlyMap<string, FpiProjection>,
  ctx: WatchCtx,
): Promise<boolean> {
  const { dataDir, now, log, error } = ctx;
  const path = fpiFilePath(ref.season, ref.seasonType, ref.week);
  let existing: FpiFile | null = null;
  try {
    const raw = await readJsonStrict(join(dataDir, path));
    if (raw !== undefined) existing = FpiFileSchema.parse(raw);
  } catch (err) {
    error(`Bestehende data/${path} ist ungültig, FPI Datei bleibt unverändert.\n${describeError(err)}`);
    return false;
  }
  if (!existing && fetched.size === 0) {
    log(`  kein FPI predictor, keine data/${path}`);
    return true;
  }
  const next = buildFpiFile({ ...ref, games, fetched, existing, now });
  if (existing && sameFpiContent(existing, next)) log(`  unverändert data/${path}`);
  else {
    await writeFiles(dataDir, [{ path, content: toJson(next) }]);
    log(`  geschrieben data/${path} (${next.games.length} Spiele mit FPI)`);
  }
  return true;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler im Wächter.", err);
      process.exitCode = 1;
    },
  );
}
