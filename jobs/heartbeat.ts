// Datenjob Lebenszeichen: schreibt data/heartbeat.json, wenn das letzte Lebenszeichen 30 Tage oder älter ist.
// So entsteht mindestens ein Commit pro Monat und GitHub deaktiviert die Workflows in der Offseason nicht.
// Aufruf: npm run job:heartbeat
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { HEARTBEAT_PATH, HEARTBEAT_SCHEMA_VERSION, HeartbeatFileSchema, heartbeatDue } from "../src/core/heartbeat";
import { DATA_DIR, type MainDeps } from "./fetch-schedule";
import { readJsonIfExists, toJson, writeFiles } from "./schedule-lib";

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  if (argv.length > 0) {
    error(`Unbekanntes Argument: ${argv.join(" ")}`);
    return 1;
  }
  const existing = await readJsonIfExists(join(dataDir, HEARTBEAT_PATH));
  if (!heartbeatDue(existing, now)) {
    log(`  unverändert data/${HEARTBEAT_PATH}`);
    return 0;
  }
  const next = HeartbeatFileSchema.parse({ schemaVersion: HEARTBEAT_SCHEMA_VERSION, updatedAt: now });
  await writeFiles(dataDir, [{ path: HEARTBEAT_PATH, content: toJson(next) }]);
  log(`  geschrieben data/${HEARTBEAT_PATH}`);
  return 0;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler im Lebenszeichen Job.", err);
      process.exitCode = 1;
    },
  );
}
