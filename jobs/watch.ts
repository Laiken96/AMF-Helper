// Ausfall Wächter (D030): lädt das ESPN Summary je offenem Spiel der Woche und schreibt
// data/injuries/<saison>-<typ>-<woche>.json mit Grundstand, aktuellem Stand und Änderungen.
// Der Grundstand wird beim ersten vollständigen Lauf ab Donnerstag 00:00 New York gesetzt und nie überschrieben.
// Aufruf: npm run job:watch [-- --season 2026 --type 2 --week 9]. Ohne Argumente gilt data/current.json.
import { readFile } from "node:fs/promises";
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
import { DATA_DIR, fetchJson, type MainDeps } from "./fetch-schedule";
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

/** Führt den Wächter aus und liefert den Exit Code. Schreibt nur bei inhaltlicher Änderung. */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  const keep = "Ausfall Datei bleibt unverändert.";

  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    error(`Ungültige Argumente. ${describeError(err)}`);
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
  let failed = 0;
  for (const g of open) {
    const url = summaryUrl(g.id);
    try {
      const parsed = parseSummary(await fetchJson(url, deps.fetch));
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
  return failed > 0 ? 1 : 0;
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
