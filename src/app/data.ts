import type { z } from "zod";
import {
  CurrentFileSchema,
  TeamsFileSchema,
  WeekFileSchema,
  type CurrentFile,
  type TeamsFile,
  type WeekFile,
  weekFilePath,
} from "../core/schema";
import {
  ReviewFileSchema,
  REVIEW_INDEX_PATH,
  ReviewIndexSchema,
  StandingsHistorySchema,
  type ReviewFile,
  type StandingsHistory,
} from "../core/review-schema";
import {
  StandingsFileSchema,
  TipsFileSchema,
  tipsFilePath,
  type StandingsFile,
  type TipsFile,
} from "../core/tips-schema";

export class LoadError extends Error {}

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

async function loadJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(dataUrl(path), { cache: "no-cache" });
  } catch {
    throw new LoadError(`Netzwerkfehler beim Laden von ${path}. Bitte Verbindung prüfen und neu laden.`);
  }
  if (!res.ok) {
    throw new LoadError(`Datei ${path} konnte nicht geladen werden (HTTP ${res.status}).`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new LoadError(`Datei ${path} ist kein gültiges JSON.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` bei Feld ${first.path.join(".")}` : "";
    throw new LoadError(`Datei ${path} entspricht nicht dem erwarteten Format${where}.`);
  }
  return parsed.data;
}

export interface WeekData {
  current: CurrentFile;
  week: WeekFile;
  teams: TeamsFile;
}

export async function loadWeekData(): Promise<WeekData> {
  const current = await loadJson("current.json", CurrentFileSchema);
  const [week, teams] = await Promise.all([
    loadJson(current.weekFile, WeekFileSchema),
    loadJson("teams.json", TeamsFileSchema),
  ]);
  return { current, week, teams };
}

export interface TipsData extends WeekData {
  standings: StandingsFile;
  /** null, wenn für diese Woche noch keine Tippdatei existiert. */
  tips: TipsFile | null;
}

/** Wie loadJson, liefert aber null, wenn die Datei fehlt (HTTP 404 oder HTML Antwort statt JSON). */
async function loadOptionalJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> {
  let res: Response;
  try {
    res = await fetch(dataUrl(path), { cache: "no-cache" });
  } catch {
    throw new LoadError(`Netzwerkfehler beim Laden von ${path}. Bitte Verbindung prüfen und neu laden.`);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new LoadError(`Datei ${path} konnte nicht geladen werden (HTTP ${res.status}).`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.includes("text/html") || /^\s*</.test(text)) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LoadError(`Datei ${path} ist kein gültiges JSON.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` bei Feld ${first.path.join(".")}` : "";
    throw new LoadError(`Datei ${path} entspricht nicht dem erwarteten Format${where}.`);
  }
  return parsed.data;
}

export async function loadTipsData(): Promise<TipsData> {
  const current = await loadJson("current.json", CurrentFileSchema);
  const [week, teams, standings, tips] = await Promise.all([
    loadJson(current.weekFile, WeekFileSchema),
    loadJson("teams.json", TeamsFileSchema),
    loadJson("standings.json", StandingsFileSchema),
    loadOptionalJson(tipsFilePath(current.season, current.seasonType, current.week), TipsFileSchema),
  ]);
  return { current, week, teams, standings, tips };
}

export interface ReviewData {
  /** Pfade aller Bilanzen, neueste zuerst. */
  index: string[];
  path: string;
  review: ReviewFile;
  /** null, wenn die Wochendatei der Bilanz fehlt. Dann fehlen Kürzel pro Spiel. */
  week: WeekFile | null;
  teams: TeamsFile;
  standings: StandingsFile;
  history: StandingsHistory;
}

/** Liste der Bilanzen, null wenn noch keine existiert. */
export async function loadReviewIndex(): Promise<string[] | null> {
  return loadOptionalJson(REVIEW_INDEX_PATH, ReviewIndexSchema);
}

/** Lädt eine Bilanz samt Wochendatei, Teams, Rangliste und Verlauf. */
export async function loadReviewData(index: string[], path: string): Promise<ReviewData> {
  const [review, teams, standings, history] = await Promise.all([
    loadJson(path, ReviewFileSchema),
    loadJson("teams.json", TeamsFileSchema),
    loadJson("standings.json", StandingsFileSchema),
    loadJson("standings-history.json", StandingsHistorySchema),
  ]);
  const week = await loadOptionalJson(weekFilePath(review.season, review.seasonType, review.week), WeekFileSchema);
  return { index, path, review, week, teams, standings, history };
}
