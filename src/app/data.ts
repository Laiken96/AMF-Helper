import type { z } from "zod";
import {
  CurrentFileSchema,
  TeamsFileSchema,
  WeekFileSchema,
  type CurrentFile,
  type TeamsFile,
  type WeekFile,
} from "../core/schema";

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
