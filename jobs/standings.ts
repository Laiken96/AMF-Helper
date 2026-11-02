// Ranglisten Job (D032): liest das Issue aus der Event Datei (GITHUB_EVENT_PATH), prüft Autor, Label und Werte
// und schreibt data/standings.json und data/standings-history.json. Der Body wird nie über die Shell weitergereicht.
// Den Text für den Issue Kommentar schreibt der Job nach COMMENT_FILE, der Workflow postet ihn.
// Exit 0: übernommen. Exit 1: abgelehnt oder Fehler, Dateien unverändert.
// Aufruf in Actions: npm run job:standings
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { StandingsFileSchema } from "../src/core/tips-schema";
import { StandingsHistorySchema, REVIEW_SCHEMA_VERSION, type StandingsHistory } from "../src/core/review-schema";
import { applyReport, authorizedReport, issueInfo, parseReportBody } from "../src/core/standings";
import { DATA_DIR, type MainDeps } from "./fetch-schedule";
import { toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

export const STANDINGS_PATH = "standings.json";
export const HISTORY_PATH = "standings-history.json";

export interface StandingsDeps extends MainDeps {
  env?: Record<string, string | undefined>;
}

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Führt den Job aus und liefert den Exit Code. */
export async function main(argv: readonly string[], deps: StandingsDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  const env = deps.env ?? process.env;

  const comment = async (text: string) => {
    if (env.COMMENT_FILE) await writeFile(env.COMMENT_FILE, `${text}\n`, "utf8");
  };
  const reject = async (reasons: string[]) => {
    const text = `Rangliste nicht übernommen, Issue bleibt offen.\n\n${reasons.map((r) => `- ${r}`).join("\n")}\n\nBitte das Issue bearbeiten, dann läuft die Prüfung erneut.`;
    error(text);
    await comment(text);
    return 1;
  };

  if (argv.length > 0) {
    error(`Unbekanntes Argument: ${argv.join(" ")}`);
    return 1;
  }
  if (!env.GITHUB_EVENT_PATH) {
    error("GITHUB_EVENT_PATH fehlt, der Job läuft nur in GitHub Actions.");
    return 1;
  }

  let event: unknown;
  try {
    event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  } catch (err) {
    error(`Event Datei nicht lesbar. ${describeError(err)}`);
    return 1;
  }
  const info = issueInfo(event);
  if (!info) {
    error("Event enthält kein Issue.");
    return 1;
  }
  // Zweite Prüfung zusätzlich zur if Bedingung im Workflow. Fremde Autoren bekommen keinen Kommentar.
  const denied = authorizedReport(info);
  if (denied) {
    error(`Nicht übernommen: ${denied}`);
    return 1;
  }

  const parsed = parseReportBody(info.body);
  if (!parsed.ok) return reject(parsed.errors);

  let standings;
  let history: StandingsHistory;
  try {
    standings = StandingsFileSchema.parse(await readJsonStrict(join(dataDir, STANDINGS_PATH)));
    const raw = await readJsonStrict(join(dataDir, HISTORY_PATH));
    history = raw === undefined ? { schemaVersion: REVIEW_SCHEMA_VERSION, entries: [] } : StandingsHistorySchema.parse(raw);
  } catch (err) {
    return reject([`Bestehende Ranglisten Daten ungültig: ${describeError(err)}`]);
  }

  const applied = applyReport(parsed.report, standings, history, now);
  if (!applied.ok) return reject(applied.errors);

  await writeFiles(dataDir, [
    { path: STANDINGS_PATH, content: toJson(applied.standings) },
    { path: HISTORY_PATH, content: toJson(applied.history) },
  ]);
  const { season, week } = parsed.report;
  const list = applied.standings.players.map((p) => `${p.id} ${p.points}`).join(", ");
  log(`Rangliste ${season} Week ${week} übernommen: ${list}`);
  await comment(`Rangliste ${season} Week ${week} übernommen: ${list}. Die App zeigt sie nach dem nächsten Pages Build.`);
  return 0;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler, Rangliste bleibt unverändert.", err);
      process.exitCode = 1;
    },
  );
}
