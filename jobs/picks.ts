// Datenjob Public Pick Prozente (D050): liest ESPN Pick'em (undokumentierte Gambit API) und schreibt
// data/picks/<saison>-<typ>-<woche>.json für die aktuelle und die nächste Woche mit Wochendatei.
// Nicht kritischer Zusatz: jeder Fehler und jede unbekannte Struktur ergibt eine Warnung und Exit 0,
// bestehende Dateien bleiben dann unverändert. Nur Regular Season, die Challenge kennt keine Playoffs.
// Aufruf: npm run job:picks [-- --season 2026 --type 2 --week 9]. Ohne Argumente gilt data/current.json.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { CurrentFileSchema, WeekFileSchema, weekFilePath } from "../src/core/schema";
import {
  PicksFileSchema,
  buildPicksFile,
  parsePickem,
  picksFilePath,
  pickemUrl,
  samePicksContent,
  type PicksFile,
} from "../src/core/picks";
import { DATA_DIR, fetchJson, upcomingWeeks, type MainDeps } from "./fetch-schedule";
import { parseCliArgs, toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

export type { MainDeps };

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

interface WeekRef {
  season: number;
  seasonType: number;
  week: number;
}

interface PicksCtx {
  dataDir: string;
  now: string;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  fetch?: MainDeps["fetch"];
}

/** Führt den Job aus. Liefert immer 0, Probleme stehen als Warnung im Log. */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const warn = (msg: string) => error(`Warnung: ${msg}`);
  const now = (deps.now ?? nowUtc)();

  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    warn(`Ungültige Argumente, nichts geschrieben. ${describeError(err)}`);
    return 0;
  }
  const explicit = args.season !== undefined || args.seasonType !== undefined || args.week !== undefined;
  let primary: WeekRef;
  try {
    const current = explicit && args.season !== undefined && args.seasonType !== undefined && args.week !== undefined
      ? null
      : CurrentFileSchema.parse(await readJsonStrict(join(dataDir, "current.json")));
    primary = {
      season: args.season ?? current!.season,
      seasonType: args.seasonType ?? current!.seasonType,
      week: args.week ?? current!.week,
    };
  } catch (err) {
    warn(`data/current.json fehlt oder ist ungültig, nichts geschrieben. ${describeError(err)}`);
    return 0;
  }

  const weeks: WeekRef[] = [primary];
  if (!explicit) {
    const next = upcomingWeeks(primary)[0];
    if (next && existsSync(join(dataDir, weekFilePath(next.season, next.seasonType, next.week)))) weeks.push(next);
  }
  const ctx: PicksCtx = { dataDir, now, log, warn, fetch: deps.fetch };
  for (const w of weeks) {
    try {
      await runWeek(w, ctx);
    } catch (err) {
      warn(`Woche ${w.season}-${w.seasonType}-${w.week}: unerwarteter Fehler, Datei bleibt unverändert. ${describeError(err)}`);
    }
  }
  return 0;
}

async function runWeek(ref: WeekRef, ctx: PicksCtx): Promise<void> {
  const { dataDir, now, log, warn } = ctx;
  const label = `${ref.season}-${ref.seasonType}-${ref.week}`;
  const keep = "Datei bleibt unverändert.";
  if (ref.seasonType !== 2) {
    log(`Woche ${label}: Pick'em gibt es nur in der Regular Season, übersprungen.`);
    return;
  }

  const weekPath = weekFilePath(ref.season, ref.seasonType, ref.week);
  let week;
  try {
    week = WeekFileSchema.parse(await readJsonStrict(join(dataDir, weekPath)));
  } catch (err) {
    warn(`data/${weekPath} fehlt oder ist ungültig. ${keep} ${describeError(err)}`);
    return;
  }
  if (week.games.length === 0) {
    log(`Woche ${label} ohne Spiele, nichts zu tun.`);
    return;
  }

  const path = picksFilePath(ref.season, ref.seasonType, ref.week);
  let existing: PicksFile | null = null;
  try {
    const raw = await readJsonStrict(join(dataDir, path));
    if (raw !== undefined) existing = PicksFileSchema.parse(raw);
  } catch (err) {
    warn(`Bestehende data/${path} ist ungültig. ${keep} ${describeError(err)}`);
    return;
  }

  const url = pickemUrl(ref.season, ref.week);
  log(`Hole ${url}`);
  let raw: unknown;
  try {
    raw = await fetchJson(url, ctx.fetch);
  } catch (err) {
    warn(`Abruf Pick'em ${label} fehlgeschlagen. ${keep} ${describeError(err)}`);
    return;
  }
  const parsed = parsePickem(raw);
  if (!parsed.ok) {
    warn(`Pick'em ${label}: unbekannte Struktur. ${keep}\n${parsed.error}`);
    return;
  }

  const { file, unmatched } = buildPicksFile({ ...ref, games: week.games, response: parsed.response, existing, now });
  log(`Woche ${label}: ${file.games.length} von ${week.games.length} Spielen mit Pick Anteilen`);
  if (unmatched.length > 0) log(`  ohne Zuordnung: ${unmatched.join(", ")}`);
  // Eine Antwort ganz ohne zuordenbares Spiel deutet auf eine geänderte API. Nichts schreiben.
  if (file.games.length === 0) {
    warn(`Pick'em ${label}: kein Spiel zuordenbar. ${keep}`);
    return;
  }
  if (existing && samePicksContent(existing, file)) {
    log(`  unverändert data/${path}`);
    return;
  }
  await writeFiles(dataDir, [{ path, content: toJson(file) }]);
  log(`  geschrieben data/${path}`);
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      // Nicht kritischer Zusatz, auch ein unerwarteter Fehler macht den Lauf nicht rot.
      console.error("Warnung: unerwarteter Fehler im Pick Job, Dateien bleiben unverändert.", err);
      process.exitCode = 0;
    },
  );
}
