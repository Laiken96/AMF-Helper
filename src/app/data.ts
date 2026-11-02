import { useEffect, useState } from "react";
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
import { InjuriesFileSchema, injuriesFilePath, type InjuriesFile } from "../core/injuries";
import { NewsFileSchema, WeeksIndexSchema, type NewsFile, type WeeksIndex } from "../core/extra-schema";
import {
  StandingsFileSchema,
  TipsFileSchema,
  tipsFilePath,
  type StandingsFile,
  type TipsFile,
} from "../core/tips-schema";

export class LoadError extends Error {}

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

async function fetchJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(dataUrl(path), { cache: "no-store" });
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

// ---------- Sitzungscache mit Hintergrundprüfung ----------
// Jede Datei wird pro Sitzung einmal geladen, auch Nachbarwochen im Hintergrund. Fehler werden nicht
// gespeichert. Solange der Tab sichtbar ist, werden alle geladenen Dateien alle 5 Minuten neu abgefragt,
// ausserdem beim Zurückkehren in die App (letzte Prüfung älter als 60 s) und beim Knopf Aktualisieren.
// Ersetzt wird nur bei geändertem Inhalt, die Ansichten laden dann aus dem Cache neu, ohne Leerzustand.

interface Entry {
  promise: Promise<unknown>;
  load: () => Promise<unknown>;
  settled: boolean;
  value?: unknown;
}

const cache = new Map<string, Entry>();
const REFRESH_EVENT = "nfl-data-refresh";
export const REVALIDATE_MS = 5 * 60_000;
const RETURN_MIN_MS = 60_000;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit.promise as Promise<T>;
  const promise = load();
  const entry: Entry = { promise, load, settled: false };
  cache.set(key, entry);
  promise.then(
    (value) => {
      entry.settled = true;
      entry.value = value;
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return promise;
}

const loadJson = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> =>
  cached(`req:${path}`, () => fetchJson(path, schema));

const loadOptionalJson = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> =>
  cached(`opt:${path}`, () => fetchOptionalJson(path, schema));

let lastCheck = Date.now();
let running: Promise<boolean> | null = null;

/**
 * Fragt alle geladenen Dateien neu ab. Geänderte Inhalte ersetzen den Cache, danach laden die Ansichten neu.
 * Fehler einzelner Dateien behalten den bisherigen Stand. Liefert true, wenn sich etwas geändert hat.
 */
export function revalidateData(): Promise<boolean> {
  if (running) return running;
  lastCheck = Date.now();
  running = (async () => {
    let changed = false;
    await Promise.all(
      [...cache.entries()]
        .filter(([, e]) => e.settled)
        .map(async ([key, e]) => {
          try {
            const value = await e.load();
            if (JSON.stringify(value) === JSON.stringify(e.value)) return;
            changed = true;
            cache.set(key, { promise: Promise.resolve(value), load: e.load, settled: true, value });
          } catch {
            // Netzwerk oder Format: bisheriger Stand bleibt
          }
        }),
    );
    if (changed) window.dispatchEvent(new Event(REFRESH_EVENT));
    return changed;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Startet die Hintergrundprüfung (5 Minuten, nur bei sichtbarem Tab). Rückgabe räumt Timer und Listener auf. */
export function startRevalidation(): () => void {
  let timer: number | undefined;
  const stop = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    timer = window.setInterval(() => void revalidateData(), REVALIDATE_MS);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }
    if (Date.now() - lastCheck >= RETURN_MIN_MS) void revalidateData();
    start();
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (document.visibilityState !== "hidden") start();
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Zähler, der bei jeder geänderten Datei steigt. Als Abhängigkeit für Ladeeffekte. */
export function useDataVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = () => setV((x) => x + 1);
    window.addEventListener(REFRESH_EVENT, on);
    return () => window.removeEventListener(REFRESH_EVENT, on);
  }, []);
  return v;
}

/** Wie loadJson, liefert aber null, wenn die Datei fehlt (HTTP 404 oder HTML Antwort statt JSON). */
async function fetchOptionalJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> {
  let res: Response;
  try {
    res = await fetch(dataUrl(path), { cache: "no-store" });
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

/** Woche als Bezug für Wochenwähler und Hash (#tipps/2026-2-10). */
export interface WeekRef {
  season: number;
  seasonType: number;
  week: number;
}

export const weekKey = (r: WeekRef): string => `${r.season}-${r.seasonType}-${String(r.week).padStart(2, "0")}`;

export function parseWeekKey(value: string | null | undefined): WeekRef | null {
  const m = /^(\d{4})-([1-3])-(\d{1,2})$/.exec(value ?? "");
  if (!m) return null;
  return { season: Number(m[1]), seasonType: Number(m[2]), week: Number(m[3]) };
}

export const compareRef = (a: WeekRef, b: WeekRef): number =>
  a.season - b.season || a.seasonType - b.seasonType || a.week - b.week;

export const sameRef = (a: WeekRef, b: WeekRef): boolean => compareRef(a, b) === 0;

export type WeekPhase = "vergangen" | "aktuell" | "kommend";

export function phaseOf(ref: WeekRef, current: WeekRef): WeekPhase {
  const c = compareRef(ref, current);
  return c < 0 ? "vergangen" : c > 0 ? "kommend" : "aktuell";
}

/** Wochenindex, null wenn er fehlt oder nicht lesbar ist. Darf die App nie blockieren. */
export async function loadWeeksIndex(): Promise<WeeksIndex | null> {
  try {
    const index = await loadOptionalJson("weeks/index.json", WeeksIndexSchema);
    if (!index) return null;
    return { ...index, weeks: [...index.weeks].sort(compareRef) };
  } catch {
    return null;
  }
}

/** News, null wenn die Datei fehlt oder nicht lesbar ist. Neueste zuerst. */
export async function loadNews(): Promise<NewsFile | null> {
  try {
    const news = await loadOptionalJson("news.json", NewsFileSchema);
    if (!news) return null;
    return { ...news, items: [...news.items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)) };
  } catch {
    return null;
  }
}

/** Pfade einer Woche aus dem Index, sonst nach Namenskonvention. */
export function weekPaths(index: WeeksIndex | null, ref: WeekRef) {
  const entry = index?.weeks.find((w) => sameRef(w, ref));
  if (entry) return { listed: true, weekFile: entry.weekFile, tipsFile: entry.tipsFile, reviewFile: entry.reviewFile };
  return {
    listed: false,
    weekFile: weekFilePath(ref.season, ref.seasonType, ref.week),
    tipsFile: tipsFilePath(ref.season, ref.seasonType, ref.week) as string | null,
    reviewFile: null as string | null,
  };
}

export interface WeekNav {
  current: CurrentFile;
  index: WeeksIndex | null;
  /** Gewählte Woche, Standard aus current.json. */
  ref: WeekRef;
  phase: WeekPhase;
}

async function loadNav(requested: WeekRef | null): Promise<WeekNav> {
  const [current, index] = await Promise.all([loadJson("current.json", CurrentFileSchema), loadWeeksIndex()]);
  const ref = requested ?? { season: current.season, seasonType: current.seasonType, week: current.week };
  return { current, index, ref, phase: phaseOf(ref, current) };
}

/** Wochendatei der gewählten Woche. Die aktuelle Woche ist Pflicht, andere Wochen dürfen fehlen. */
async function loadWeekFile(nav: WeekNav): Promise<WeekFile | null> {
  if (nav.phase === "aktuell") return loadJson(nav.current.weekFile, WeekFileSchema);
  return loadOptionalJson(weekPaths(nav.index, nav.ref).weekFile, WeekFileSchema);
}

export interface WeekData extends WeekNav {
  /** null, wenn für eine andere als die aktuelle Woche keine Wochendatei existiert. */
  week: WeekFile | null;
  teams: TeamsFile;
}

export async function loadWeekData(requested: WeekRef | null = null): Promise<WeekData> {
  const nav = await loadNav(requested);
  const [week, teams] = await Promise.all([loadWeekFile(nav), loadJson("teams.json", TeamsFileSchema)]);
  return { ...nav, week, teams };
}

export interface TipsData extends WeekData {
  standings: StandingsFile;
  /** null, wenn für diese Woche noch keine Tippdatei existiert. */
  tips: TipsFile | null;
  /** null, wenn die Ausfall Datei der Woche fehlt oder nicht lesbar ist. Nur Anzeige im Spielbereich. */
  injuries: InjuriesFile | null;
  /** null, wenn data/news.json fehlt. Nur Schlagzeilen im Spielbereich. */
  news: NewsFile | null;
}

export async function loadTipsData(requested: WeekRef | null = null): Promise<TipsData> {
  const nav = await loadNav(requested);
  const { ref } = nav;
  const paths = weekPaths(nav.index, ref);
  // Aktuelle Woche wie bisher nach Namenskonvention, auch wenn der Index noch keine Tippdatei kennt
  const tipsPath =
    paths.tipsFile ?? (nav.phase === "aktuell" ? tipsFilePath(ref.season, ref.seasonType, ref.week) : null);
  const [week, teams, standings, tips, injuries, news] = await Promise.all([
    loadWeekFile(nav),
    loadJson("teams.json", TeamsFileSchema),
    loadJson("standings.json", StandingsFileSchema),
    tipsPath ? loadOptionalJson(tipsPath, TipsFileSchema) : Promise.resolve(null),
    // Ausfälle und News sind Zusatz: Fehler hier dürfen die Tippliste nie blockieren
    nav.phase === "vergangen"
      ? Promise.resolve(null)
      : loadOptionalJson(injuriesFilePath(ref.season, ref.seasonType, ref.week), InjuriesFileSchema).catch(() => null),
    nav.phase === "vergangen" ? Promise.resolve(null) : loadNews(),
  ]);
  return { ...nav, week, teams, standings, tips, injuries, news };
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

/** current.json, null wenn sie fehlt oder nicht lesbar ist. Nur für Zusatzansichten wie Bilanz und News. */
export async function loadCurrent(): Promise<CurrentFile | null> {
  try {
    return await loadJson("current.json", CurrentFileSchema);
  } catch {
    return null;
  }
}

/**
 * Wochen für den Wochenwähler, aufsteigend. null heisst ohne Index und in der aktuellen Woche:
 * kein Wähler, Verhalten wie vor dem Ausbau.
 */
export function navWeeks(nav: WeekNav): WeekRef[] | null {
  const current: WeekRef = { season: nav.current.season, seasonType: nav.current.seasonType, week: nav.current.week };
  if (!nav.index && sameRef(nav.ref, current)) return null;
  const list: WeekRef[] = nav.index ? nav.index.weeks.map(({ season, seasonType, week }) => ({ season, seasonType, week })) : [];
  for (const r of [current, nav.ref]) if (!list.some((w) => sameRef(w, r))) list.push(r);
  return list.sort(compareRef);
}

export const currentRef = (c: CurrentFile): WeekRef => ({ season: c.season, seasonType: c.seasonType, week: c.week });

export interface KeptLoad<T> {
  data: T | null;
  error: string | null;
  /** Neue Daten werden geladen, data zeigt noch den bisherigen Stand. */
  pending: boolean;
}

/**
 * Lädt bei jeder Änderung von key neu, lässt den bisherigen Inhalt aber stehen, bis die neuen Daten da sind.
 * Kein leerer Zwischenzustand beim Wochenwechsel. Lädt auch nach einer Hintergrundaktualisierung neu, ohne Ladeindikator.
 */
export function useKeptLoad<T>(key: string, load: () => Promise<T>): KeptLoad<T> {
  const version = useDataVersion();
  const [state, setState] = useState<KeptLoad<T>>({ data: null, error: null, pending: true });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Wochenwechsel zeigt den Ladeindikator, eine Hintergrundaktualisierung nicht
    if (loadedKey !== key) setState((s) => (s.pending ? s : { ...s, pending: true }));
    load()
      .then((data) => {
        if (!active) return;
        setState({ data, error: null, pending: false });
        setLoadedKey(key);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message = err instanceof LoadError ? err.message : "Unerwarteter Fehler beim Laden der Daten.";
        setState((s) => (loadedKey === key && s.data ? { ...s, pending: false } : { data: null, error: message, pending: false }));
      });
    return () => {
      active = false;
    };
    // load ändert sich mit key, key ist die Identität des Ladevorgangs
  }, [key, version]);
  return state;
}

/** Vorladen der Nachbarwochen im Hintergrund, Ergebnis landet im Sitzungscache. */
export function prefetchNeighbours(nav: WeekNav, load: (ref: WeekRef) => Promise<unknown>): void {
  const weeks = navWeeks(nav);
  if (!weeks) return;
  const i = weeks.findIndex((w) => sameRef(w, nav.ref));
  for (const r of [weeks[i - 1], weeks[i + 1]]) if (r) void load(r).catch(() => undefined);
}
