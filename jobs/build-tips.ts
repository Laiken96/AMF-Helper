// Datenjob Tippliste: holt das ESPN Scoreboard mit Quoten und schreibt data/tips/<saison>-<typ>-<woche>.json.
// Liest data/standings.json und die bestehende Tippdatei. Bei Fehler bleibt die Datei unverändert und der Exit Code ist 1.
// Aufruf: npm run job:tips [-- --season 2026 --type 2 --week 9]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseOdds, parseScoreboard, scoreboardUrl } from "../src/core/espn";
import { buildTipsFile, sameTipsContent } from "../src/core/tips";
import { StandingsFileSchema, TipsFileSchema, tipsFilePath, type TipsFile } from "../src/core/tips-schema";
import { DATA_DIR, fetchJson, type MainDeps } from "./fetch-schedule";
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

/** Führt den Job aus und liefert den Exit Code. Schreibt nur bei inhaltlicher Änderung. */
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
  const url = scoreboardUrl(args);
  log(`Hole ${url}`);

  let raw: unknown;
  try {
    raw = await fetchJson(url, deps.fetch);
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
  const odds = parseOdds(raw, now);
  const path = tipsFilePath(week.season, week.seasonType, week.week);

  let standings;
  try {
    standings = StandingsFileSchema.parse(await readJsonStrict(join(dataDir, "standings.json")));
  } catch (err) {
    const msg = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
    error(`data/standings.json fehlt oder ist ungültig. ${keep}\n${msg}`);
    return 1;
  }

  let existing: TipsFile | null = null;
  try {
    const prevRaw = await readJsonStrict(join(dataDir, path));
    if (prevRaw !== undefined) existing = TipsFileSchema.parse(prevRaw);
  } catch (err) {
    const msg = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
    error(`Bestehende data/${path} ist ungültig, gesperrte Tipps würden verloren gehen. ${keep}\n${msg}`);
    return 1;
  }
  if (existing && (existing.season !== week.season || existing.seasonType !== week.seasonType || existing.week !== week.week)) {
    error(`data/${path} gehört zu einer anderen Woche. ${keep}`);
    return 1;
  }

  // D019: bekannte Spiele dürfen ohne explizit gewählte Woche nicht verschwinden.
  if (existing && !explicit && existing.tips.length > 0) {
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

  let next: TipsFile;
  try {
    next = buildTipsFile({ week, odds, standings, existing, now });
  } catch (err) {
    error(`Tipps nicht berechenbar. ${keep} ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const withOdds = next.tips.filter((t) => t.odds !== null).length;
  const locked = next.tips.filter((t) => t.locked).length;
  log(
    `Saison ${week.season} Typ ${week.seasonType} Woche ${week.week}: ${next.tips.length} Spiele, ` +
      `${withOdds} mit Quote, ${locked} gesperrt, ${next.maxDeviations} Abweichungen erlaubt`,
  );
  if (existing && sameTipsContent(existing, next)) {
    log(`  unverändert data/${path}`);
    return 0;
  }
  await writeFiles(dataDir, [{ path, content: toJson(next) }]);
  log(`  geschrieben data/${path}`);
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
