// Datenjob Spielplan: holt das ESPN Scoreboard und schreibt data/teams.json, data/weeks/..., data/current.json
// und data/settings.json. Bei Fehler bleiben die bestehenden Dateien unverändert und der Exit Code ist 1.
// Aufruf: npm run job:schedule [-- --season 2026 --type 2 --week 8]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreboardUrl } from "../src/core/espn";
import { weekFilePath } from "../src/core/schema";
import {
  FETCH_TIMEOUT_MS,
  USER_AGENT,
  buildOutputs,
  parseCliArgs,
  readExisting,
  writeFiles,
} from "./schedule-lib";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
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

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const explicit = args.season !== undefined || args.seasonType !== undefined || args.week !== undefined;
  const url = scoreboardUrl(args);
  console.log(`Hole ${url}`);

  let raw: unknown;
  try {
    raw = await fetchJson(url);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`Fehler beim Abruf, bestehende Dateien bleiben unverändert. ${msg}`);
    process.exitCode = 1;
    return;
  }

  // Erst parsen, um den Pfad der Woche zu kennen, dann mit bestehenden Dateien vergleichen.
  const probe = buildOutputs({ raw, now: new Date().toISOString(), updateCurrent: false, existing: {} });
  if (!probe.ok) {
    console.error(`Schemafehler, bestehende Dateien bleiben unverändert.\n${probe.error}`);
    process.exitCode = 1;
    return;
  }
  const w = probe.week;
  const existing = await readExisting(DATA_DIR, weekFilePath(w.season, w.seasonType, w.week));
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = buildOutputs({ raw, now, updateCurrent: !explicit, existing });
  if (!result.ok) {
    console.error(`Schemafehler, bestehende Dateien bleiben unverändert.\n${result.error}`);
    process.exitCode = 1;
    return;
  }

  await writeFiles(DATA_DIR, result.files);
  console.log(
    `Saison ${w.season} Typ ${w.seasonType} Woche ${w.week}: ${w.games.length} Spiele, ${w.byeTeamIds.length} Bye Teams`,
  );
  for (const f of result.files) console.log(`  geschrieben data/${f.path}`);
  for (const p of result.unchanged) console.log(`  unverändert data/${p}`);
  if (explicit) console.log("  current.json nicht angepasst, da Woche explizit gewählt");
}

main().catch((err: unknown) => {
  console.error("Unerwarteter Fehler, bestehende Dateien bleiben unverändert.", err);
  process.exitCode = 1;
});
