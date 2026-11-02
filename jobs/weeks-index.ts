// Datenjob Wochenindex (D042): schreibt data/weeks/index.json aus den vorhandenen Dateien unter data/.
// Läuft als letzter Schritt im Datenjob. Schreibt nur bei inhaltlicher Änderung.
// Aufruf: npm run job:index
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { WeeksIndexSchema } from "../src/core/extra-schema";
import { WEEKS_INDEX_PATH, buildWeeksIndex, parseWeekFileName, sameWeeksIndex, type WeekKey } from "../src/core/weeks-index";
import { DATA_DIR, type MainDeps } from "./fetch-schedule";
import { toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Alle Wochen mit Datei im Unterordner, z. B. "weeks" oder "tips". Fehlt der Ordner, kommt eine leere Liste. */
export async function listWeekFiles(dataDir: string, sub: string): Promise<WeekKey[]> {
  let names: string[];
  try {
    names = await readdir(join(dataDir, sub));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return names.flatMap((n) => {
    const k = parseWeekFileName(n);
    return k ? [k] : [];
  });
}

export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  if (argv.length > 0) {
    error(`Unbekanntes Argument: ${argv.join(" ")}`);
    return 1;
  }
  try {
    const weeks = await listWeekFiles(dataDir, "weeks");
    const next = buildWeeksIndex(weeks, (p) => existsSync(join(dataDir, p)), now);
    let prev = null;
    try {
      const raw = await readJsonStrict(join(dataDir, WEEKS_INDEX_PATH));
      if (raw !== undefined) prev = WeeksIndexSchema.parse(raw);
    } catch (err) {
      log(`Bestehender Index ungültig, wird ersetzt. ${describeError(err)}`);
    }
    const label = next.weeks.map((w) => `${w.season}-${w.seasonType}-${w.week}`).join(", ");
    if (prev && sameWeeksIndex(prev, next)) {
      log(`  unverändert data/${WEEKS_INDEX_PATH} (${next.weeks.length} Wochen: ${label})`);
      return 0;
    }
    await writeFiles(dataDir, [{ path: WEEKS_INDEX_PATH, content: toJson(next) }]);
    log(`  geschrieben data/${WEEKS_INDEX_PATH} (${next.weeks.length} Wochen: ${label})`);
    return 0;
  } catch (err) {
    error(`Wochenindex fehlgeschlagen, data/${WEEKS_INDEX_PATH} bleibt unverändert. ${describeError(err)}`);
    return 1;
  }
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler im Wochenindex Job.", err);
      process.exitCode = 1;
    },
  );
}
