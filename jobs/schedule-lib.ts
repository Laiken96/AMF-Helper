// Hilfsfunktionen für jobs/fetch-schedule.ts. Getrennt vom Einstieg, damit Tests ohne Netz laufen.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compareTeams, parseScoreboard } from "../src/core/espn";
import {
  CurrentFileSchema,
  SCHEMA_VERSION,
  SettingsFileSchema,
  TeamsFileSchema,
  WeekFileSchema,
  weekFilePath,
  type CurrentFile,
  type SettingsFile,
  type Team,
  type TeamsFile,
  type WeekFile,
} from "../src/core/schema";

export const USER_AGENT = "nfl-dashboard-data-job/0.1 (+https://github.com/Laiken96/AMF-Helper)";
export const FETCH_TIMEOUT_MS = 15_000;

export const DEFAULT_SETTINGS: SettingsFile = {
  schemaVersion: SCHEMA_VERSION,
  lockMode: "per_kickoff",
  timezone: "Europe/Zurich",
};

/** JSON mit 2 Leerzeichen und abschliessendem Zeilenumbruch. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // Kaputte bestehende Datei zählt als nicht vorhanden und wird ersetzt.
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
}

/** Vergleicht zwei Objekte ohne die angegebenen Zeitstempel Felder. */
function sameContent(a: unknown, b: unknown, ignore: readonly string[]): boolean {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const strip = (o: object) =>
    JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !ignore.includes(k))));
  return strip(a) === strip(b);
}

export interface PlannedFile {
  /** Pfad relativ zu data/ */
  path: string;
  content: string;
}

export interface BuildInput {
  raw: unknown;
  now: string;
  /** current.json nur bei Abruf der aktuellen Woche umsetzen. */
  updateCurrent: boolean;
  /** Erlaubt, dass Spiele der bestehenden Woche wegfallen. Nur bei explizit per CLI gewählter Woche. */
  allowShrink?: boolean;
  existing: {
    teams?: unknown;
    week?: unknown;
    current?: unknown;
    settings?: unknown;
  };
}

export type BuildResult =
  | { ok: true; week: WeekFile; files: PlannedFile[]; unchanged: string[] }
  | { ok: false; error: string };

/**
 * Baut alle Ausgabedateien und prüft sie gegen den Datenvertrag.
 * Dateien, deren Inhalt sich ausser Zeitstempeln nicht geändert hat, werden nicht neu geschrieben,
 * damit Commits nur echte Änderungen zeigen.
 */
export function buildOutputs(input: BuildInput): BuildResult {
  const parsed = parseScoreboard(input.raw, { fetchedAt: input.now });
  if (!parsed.ok) return parsed;
  const { week } = parsed;

  // Schutz vor einer leeren oder unvollständigen Antwort: bekannte Spiele dürfen nicht verschwinden.
  const prevWeek = WeekFileSchema.safeParse(input.existing.week);
  const sameWeek =
    prevWeek.success &&
    prevWeek.data.season === week.season &&
    prevWeek.data.seasonType === week.seasonType &&
    prevWeek.data.week === week.week;
  if (sameWeek && !input.allowShrink && prevWeek.data.games.length > 0) {
    const newIds = new Set(week.games.map((g) => g.id));
    const missing = prevWeek.data.games.map((g) => g.id).filter((id) => !newIds.has(id));
    if (missing.length > 0) {
      const what = week.games.length === 0 ? "Antwort enthält keine Spiele" : `Spiele fehlen: ${missing.join(", ")}`;
      return {
        ok: false,
        error:
          `Woche ${week.season}-${week.seasonType}-${week.week} nicht überschrieben, ${what}. ` +
          "Zum bewussten Überschreiben die Woche per --season --type --week wählen.",
      };
    }
  }

  const files: PlannedFile[] = [];
  const unchanged: string[] = [];

  // Teams: bestehende behalten und mit neuen Daten überschreiben, damit Wochen mit weniger Teams nichts verlieren.
  const prevTeams = TeamsFileSchema.safeParse(input.existing.teams);
  const merged = new Map<string, Team>();
  if (prevTeams.success) for (const t of prevTeams.data.teams) merged.set(t.id, t);
  // Kommende Wochen liefern teils keine Farbe oder kein Logo. Dann bleibt der bekannte Wert.
  for (const t of parsed.teams) {
    const prev = merged.get(t.id);
    merged.set(t.id, prev ? { ...t, logo: t.logo ?? prev.logo, color: t.color ?? prev.color } : t);
  }
  const teamsFile: TeamsFile = TeamsFileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    fetchedAt: input.now,
    teams: [...merged.values()].sort(compareTeams),
  });
  if (prevTeams.success && sameContent(prevTeams.data, teamsFile, ["fetchedAt"])) unchanged.push("teams.json");
  else files.push({ path: "teams.json", content: toJson(teamsFile) });

  const weekPath = weekFilePath(week.season, week.seasonType, week.week);
  if (prevWeek.success && sameContent(prevWeek.data, week, ["fetchedAt"])) unchanged.push(weekPath);
  else files.push({ path: weekPath, content: toJson(WeekFileSchema.parse(week)) });

  if (input.updateCurrent) {
    const current: CurrentFile = CurrentFileSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      season: week.season,
      seasonType: week.seasonType,
      week: week.week,
      weekFile: weekPath,
      updatedAt: input.now,
    });
    const prevCurrent = CurrentFileSchema.safeParse(input.existing.current);
    if (prevCurrent.success && sameContent(prevCurrent.data, current, ["updatedAt"])) unchanged.push("current.json");
    else files.push({ path: "current.json", content: toJson(current) });
  }

  // D016: settings.json nur anlegen, nie überschreiben, damit eine manuelle Änderung bleibt.
  if (input.existing.settings === undefined) {
    files.push({ path: "settings.json", content: toJson(SettingsFileSchema.parse(DEFAULT_SETTINGS)) });
  } else {
    unchanged.push("settings.json");
  }

  return { ok: true, week, files, unchanged };
}

/** Liest die bestehenden Dateien, die buildOutputs zum Vergleich braucht. */
export async function readExisting(dataDir: string, weekPath?: string): Promise<BuildInput["existing"]> {
  return {
    teams: await readJsonIfExists(join(dataDir, "teams.json")),
    week: weekPath ? await readJsonIfExists(join(dataDir, weekPath)) : undefined,
    current: await readJsonIfExists(join(dataDir, "current.json")),
    settings: await readJsonIfExists(join(dataDir, "settings.json")),
  };
}

/** Schreibt erst alle Dateien als .tmp und benennt sie danach um, damit nie halbe Dateien liegen bleiben. */
export async function writeFiles(dataDir: string, files: readonly PlannedFile[]): Promise<void> {
  const tmps: Array<{ tmp: string; target: string }> = [];
  for (const f of files) {
    const target = join(dataDir, f.path);
    const tmp = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tmp, f.content, "utf8");
    tmps.push({ tmp, target });
  }
  for (const { tmp, target } of tmps) await rename(tmp, target);
}

export interface CliArgs {
  season?: number;
  seasonType?: number;
  week?: number;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = {};
  const keys: Record<string, keyof CliArgs> = { "--season": "season", "--type": "seasonType", "--week": "week" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.split("=", 2) as [string, string | undefined];
    const key = keys[flag];
    if (!key) throw new Error(`Unbekanntes Argument: ${arg}`);
    const value = inline ?? argv[++i];
    const n = Number(value);
    if (value === undefined || !Number.isInteger(n) || n < 0) throw new Error(`Ungültiger Wert für ${flag}: ${value}`);
    out[key] = n;
  }
  return out;
}
