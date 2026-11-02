// Datenjob Tippliste: holt das ESPN Scoreboard mit Quoten und schreibt data/tips/<saison>-<typ>-<woche>.json.
// Liest data/standings.json und die bestehende Tippdatei. Bei Fehler bleibt die Datei unverändert und der Exit Code ist 1.
// Aufruf: npm run job:tips [-- --season 2026 --type 2 --week 9]
// Ohne Argumente gilt die Woche aus data/current.json, damit Tipps und Spielplan dieselbe Woche zeigen.
// Dazu die kommenden Wochen mit Wochendatei, sobald ESPN dort eine Quote liefert (D042).
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseOdds, parseScoreboard, scoreboardUrl, type ScoreboardQuery } from "../src/core/espn";
import { buildTipsFile, sameTipsContent } from "../src/core/tips";
import { CurrentFileSchema, weekFilePath, type CurrentFile } from "../src/core/schema";
import {
  StandingsFileSchema,
  TipsFileSchema,
  tipsFilePath,
  type StandingsFile,
  type TipsFile,
} from "../src/core/tips-schema";
import { DATA_DIR, fetchJson, upcomingWeeks, type MainDeps } from "./fetch-schedule";
import { parseCliArgs, toJson, writeFiles } from "./schedule-lib";

export type { MainDeps };

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Liest eine JSON Datei. Fehlt sie, kommt undefined. Kaputtes JSON wirft, damit gesperrte Tipps nie verloren gehen. */
async function readJsonStrict(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text);
}

type Mode = "explicit" | "current" | "upcoming";

interface WeekCtx {
  dataDir: string;
  now: string;
  log: (msg: string) => void;
  error: (msg: string) => void;
  fetch?: MainDeps["fetch"];
  standings: StandingsFile;
  /** updatedAt aus current.json, nur im Modus current. */
  currentUpdatedAt?: string;
}

/**
 * Führt den Job aus und liefert den Exit Code. Schreibt nur bei inhaltlicher Änderung.
 * Ohne Argumente: aktuelle Woche aus current.json, danach die kommenden Wochen mit Wochendatei,
 * sobald dort eine Quote existiert (D042). Ein Fehler in einer Woche lässt die anderen laufen.
 */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  const keep = "Tippdatei bleibt unverändert.";

  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    error(`Ungültige Argumente. ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const explicit = args.season !== undefined || args.seasonType !== undefined || args.week !== undefined;
  let current: CurrentFile | null = null;
  if (!explicit) {
    try {
      current = CurrentFileSchema.parse(await readJsonStrict(join(dataDir, "current.json")));
      args = { season: current.season, seasonType: current.seasonType, week: current.week };
    } catch (err) {
      error(`data/current.json fehlt oder ist ungültig. ${keep}\n${describe(err)}`);
      return 1;
    }
  }

  let standings: StandingsFile;
  try {
    standings = StandingsFileSchema.parse(await readJsonStrict(join(dataDir, "standings.json")));
  } catch (err) {
    error(`data/standings.json fehlt oder ist ungültig. ${keep}\n${describe(err)}`);
    return 1;
  }

  const ctx: WeekCtx = { dataDir, now, log, error, fetch: deps.fetch, standings, currentUpdatedAt: current?.updatedAt };
  let exit = await runWeek(args, explicit ? "explicit" : "current", ctx);
  if (current) {
    for (const k of upcomingWeeks(current)) {
      if (!existsSync(join(dataDir, weekFilePath(k.season, k.seasonType, k.week)))) continue;
      if ((await runWeek(k, "upcoming", ctx)) !== 0) exit = 1;
    }
  }
  return exit;
}

function describe(err: unknown): string {
  return err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
}

async function runWeek(args: ScoreboardQuery, mode: Mode, ctx: WeekCtx): Promise<number> {
  const { dataDir, now, log, error } = ctx;
  const keep = "Tippdatei bleibt unverändert.";
  const url = scoreboardUrl(args);
  log(`Hole ${url}`);

  let raw: unknown;
  try {
    raw = await fetchJson(url, ctx.fetch);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    error(`Fehler beim Abruf. ${keep} ${msg}`);
    return 1;
  }

  const parsed = parseScoreboard(raw, { fetchedAt: now });
  if (!parsed.ok) {
    error(`Schemafehler. ${keep}\n${parsed.error}`);
    return 1;
  }
  const week = parsed.week;
  if (
    mode === "upcoming" &&
    (week.season !== args.season || week.seasonType !== args.seasonType || week.week !== args.week)
  ) {
    error(`ESPN lieferte ${week.season}-${week.seasonType}-${week.week} statt ${args.season}-${args.seasonType}-${args.week}. ${keep}`);
    return 1;
  }
  const odds = parseOdds(raw, now);
  const path = tipsFilePath(week.season, week.seasonType, week.week);

  let existing: TipsFile | null = null;
  try {
    const prevRaw = await readJsonStrict(join(dataDir, path));
    if (prevRaw !== undefined) existing = TipsFileSchema.parse(prevRaw);
  } catch (err) {
    error(`Bestehende data/${path} ist ungültig, gesperrte Tipps würden verloren gehen. ${keep}\n${describe(err)}`);
    return 1;
  }
  if (existing && (existing.season !== week.season || existing.seasonType !== week.seasonType || existing.week !== week.week)) {
    error(`data/${path} gehört zu einer anderen Woche. ${keep}`);
    return 1;
  }

  // Kommende Woche: erst mit der ersten Quote eine Datei anlegen.
  if (mode === "upcoming" && !existing && !week.games.some((g) => (odds[g.id] ?? null) !== null)) {
    log(`Woche ${week.season}-${week.seasonType}-${week.week}: noch keine Quote, keine Tippdatei`);
    return 0;
  }

  // D019: bekannte Spiele dürfen ohne explizit gewählte Woche nicht verschwinden.
  if (existing && mode !== "explicit" && existing.tips.length > 0) {
    const ids = new Set(week.games.map((g) => g.id));
    const missing = existing.tips.map((t) => t.gameId).filter((id) => !ids.has(id));
    if (missing.length > 0) {
      const what = week.games.length === 0 ? "Antwort enthält keine Spiele" : `Spiele fehlen: ${missing.join(", ")}`;
      error(
        `Woche ${week.season}-${week.seasonType}-${week.week} nicht überschrieben, ${what}. ` +
          "Zum bewussten Überschreiben die Woche per --season --type --week wählen.",
      );
      return 1;
    }
  }

  // D034 mit D042: maxDeviations friert im ersten Lauf als aktuelle Woche ein. Vorher (kommende Woche)
  // folgt der Wert der Rangliste. Ein Lauf als aktuelle Woche schreibt die Datei immer, damit updatedAt
  // danach jünger ist als current.json und der Wert gesperrt bleibt.
  let freeze = true;
  if (mode === "upcoming") freeze = false;
  if (mode === "current" && existing && ctx.currentUpdatedAt !== undefined) {
    freeze = Date.parse(existing.updatedAt) >= Date.parse(ctx.currentUpdatedAt);
  }

  let next: TipsFile;
  try {
    next = buildTipsFile({ week, odds, standings: ctx.standings, existing, now, freezeMaxDeviations: freeze });
  } catch (err) {
    error(`Tipps nicht berechenbar. ${keep} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const withOdds = next.tips.filter((t) => t.odds !== null).length;
  const locked = next.tips.filter((t) => t.locked).length;
  log(
    `Saison ${week.season} Typ ${week.seasonType} Woche ${week.week}${mode === "upcoming" ? " (kommend)" : ""}: ` +
      `${next.tips.length} Spiele, ${withOdds} mit Quote, ${locked} gesperrt, ${next.maxDeviations} Abweichungen erlaubt`,
  );
  const forceWrite = mode === "current" && existing !== null && !freeze;
  if (existing && !forceWrite && sameTipsContent(existing, next)) {
    log(`  unverändert data/${path}`);
    return 0;
  }
  await writeFiles(dataDir, [{ path, content: toJson(next) }]);
  log(`  geschrieben data/${path}${forceWrite ? " (Abweichungen für die Woche eingefroren)" : ""}`);
  return 0;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler, Tippdatei bleibt unverändert.", err);
      process.exitCode = 1;
    },
  );
}
