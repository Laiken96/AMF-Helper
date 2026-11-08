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
  type ReviewFile,
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
import { FpiFileSchema, fpiFilePath, type FpiFile } from "../core/fpi";
import { PicksFileSchema, picksFilePath, type PicksFile } from "../core/picks";
import { nextTipWeeks } from "../core/season-calendar";
import { DATA_TIMEOUT_MS, isTimeout, timeoutSignal } from "./net";

export class LoadError extends Error {}

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

/** Holt eine Datei als Text, mit Zeitlimit. HTTP 404 liefert null, wenn allowMissing gesetzt ist. */
async function fetchText(path: string, allowMissing: boolean): Promise<{ text: string; contentType: string } | null> {
  try {
    const res = await fetch(dataUrl(path), { cache: "no-store", signal: timeoutSignal(DATA_TIMEOUT_MS) });
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) throw new LoadError(`Datei ${path} konnte nicht geladen werden (HTTP ${res.status}).`);
    // Der Text gehört zum Abruf: auch ein hängender Body fällt unter das Zeitlimit
    return { text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
  } catch (err) {
    if (err instanceof LoadError) throw err;
    if (isTimeout(err)) {
      throw new LoadError(`Zeitüberschreitung beim Laden von ${path}. Bitte Verbindung prüfen und erneut versuchen.`);
    }
    throw new LoadError(`Netzwerkfehler beim Laden von ${path}. Bitte Verbindung prüfen und erneut versuchen.`);
  }
}

function parseText<S extends z.ZodType>(path: string, text: string, schema: S): z.infer<S> {
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

async function fetchJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const res = await fetchText(path, false);
  return parseText(path, res!.text, schema);
}

// ---------- Sitzungscache mit Hintergrundprüfung ----------
// Jede Datei wird pro Sitzung einmal geladen, auch Nachbarwochen im Hintergrund. Fehler werden nicht
// im Cache gespeichert, aber als fehlgeschlagen gemerkt. Solange der Tab sichtbar ist, werden alle geladenen
// und alle fehlgeschlagenen Dateien alle 5 Minuten neu abgefragt, ausserdem beim Zurückkehren in die App
// (letzte Prüfung älter als 60 s), beim Knopf Aktualisieren und beim Knopf Erneut versuchen.
// Ersetzt wird nur bei geändertem Inhalt, die Ansichten laden dann aus dem Cache neu, ohne Leerzustand.
// Gelingt eine zuvor fehlgeschlagene Datei, laden die Ansichten ebenfalls neu, auch solche im Fehlerzustand.

interface Entry {
  promise: Promise<unknown>;
  load: () => Promise<unknown>;
  settled: boolean;
  value?: unknown;
}

const cache = new Map<string, Entry>();
/** Fehlgeschlagene Abrufe mit ihrer Ladefunktion, für den nächsten Versuch. */
const failed = new Map<string, () => Promise<unknown>>();
const REFRESH_EVENT = "nfl-data-refresh";
export const REVALIDATE_MS = 5 * 60_000;
const RETURN_MIN_MS = 60_000;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit.promise as Promise<T>;
  const promise = load();
  const entry: Entry = { promise, load, settled: false };
  cache.set(key, entry);
  failed.delete(key);
  promise.then(
    (value) => {
      entry.settled = true;
      entry.value = value;
    },
    () => {
      if (cache.get(key) !== entry) return;
      cache.delete(key);
      failed.set(key, load);
    },
  );
  return promise;
}

const loadJson = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> =>
  cached(`req:${path}`, () => fetchJson(path, schema));

const loadOptionalJson = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> =>
  cached(`opt:${path}`, () => fetchOptionalJson(path, schema));

/** Optionale Datei über den Sitzungscache, null wenn sie fehlt. */
export const loadOptionalDataFile = loadOptionalJson;

let lastCheck = Date.now();

// Angezeigte Woche der offenen Ansicht. Die Hintergrundprüfung fragt nur Dateien dieser Woche, der aktuellen
// Woche und Dateien ohne Wochenbezug neu ab. Vorgeladene Nachbarwochen bleiben aus dem Cache, bis sie angezeigt werden.
let shownWeek: WeekRef | null = null;

/** Merkt die angezeigte Woche für die Hintergrundprüfung. null ohne Wochenbezug (News, Einstellungen). */
export function setShownWeek(ref: WeekRef | null): void {
  shownWeek = ref;
}

/** Woche im Dateipfad, z. B. tips/2026-2-09.json, null ohne Wochenbezug. */
export function weekOfPath(path: string): WeekRef | null {
  const m = /(\d{4})-([1-3])-(\d{2})(?:\.json)?$/.exec(path);
  return m ? { season: Number(m[1]), seasonType: Number(m[2]), week: Number(m[3]) } : null;
}

/**
 * Welche Cache Einträge eine Prüfung neu abfragt: ohne Wochenbezug immer, sonst nur die aktuelle Woche aus
 * current.json und die angezeigte Woche.
 */
export function shouldRevalidate(path: string, current: WeekRef | null, shown: WeekRef | null): boolean {
  const ref = weekOfPath(path);
  if (!ref) return true;
  return (current !== null && sameRef(ref, current)) || (shown !== null && sameRef(ref, shown));
}

function revalidationFilter(): (key: string) => boolean {
  const cur = cache.get("req:current.json")?.value as CurrentFile | undefined;
  const current = cur ? currentRef(cur) : null;
  return (key: string) => shouldRevalidate(key.replace(/^(req|opt):/, ""), current, shownWeek);
}
let running: Promise<boolean> | null = null;

const notifyViews = () => window.dispatchEvent(new Event(REFRESH_EVENT));

/**
 * Fragt alle geladenen Dateien neu ab, dazu alle zuvor fehlgeschlagenen. Geänderte Inhalte ersetzen den Cache,
 * danach laden die Ansichten neu. Fehler einzelner Dateien behalten den bisherigen Stand.
 * Liefert true, wenn sich etwas geändert hat oder eine fehlgeschlagene Datei jetzt geladen werden konnte.
 * Jeder Abruf hat ein Zeitlimit (DATA_TIMEOUT_MS), darum endet ein Durchgang immer.
 */
export function revalidateData(): Promise<boolean> {
  if (running) return running;
  lastCheck = Date.now();
  running = (async () => {
    let changed = false;
    const relevant = revalidationFilter();
    const settled = [...cache.entries()].filter(([key, e]) => e.settled && relevant(key));
    const retry = [...failed.entries()].filter(([key]) => relevant(key));
    await Promise.all([
      ...settled.map(async ([key, e]) => {
        try {
          const value = await e.load();
          if (JSON.stringify(value) === JSON.stringify(e.value)) return;
          changed = true;
          cache.set(key, { promise: Promise.resolve(value), load: e.load, settled: true, value });
        } catch {
          // Netzwerk oder Format: bisheriger Stand bleibt
        }
      }),
      ...retry.map(async ([key, load]) => {
        try {
          const value = await load();
          if (failed.get(key) === load) failed.delete(key);
          changed = true;
          // Hat eine Ansicht die Datei inzwischen selbst neu angefordert, bleibt deren Abruf bestehen
          if (!cache.has(key)) cache.set(key, { promise: Promise.resolve(value), load, settled: true, value });
        } catch {
          // Weiterhin fehlgeschlagen: nächster Versuch bei der nächsten Prüfung
        }
      }),
    ]);
    if (changed) notifyViews();
    return changed;
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Knopf Erneut versuchen: prüft wie revalidateData. Gab es keine fehlgeschlagene Datei zum Wiederholen, laden
 * die Ansichten trotzdem neu, damit auch ein Fehler ausserhalb des Caches einen neuen Versuch bekommt.
 * Geladene Dateien kommen dabei aus dem Cache.
 */
export async function retryLoad(): Promise<void> {
  const hadFailed = failed.size > 0;
  const changed = await revalidateData();
  if (!changed && !hadFailed) notifyViews();
}

/** Nur für Tests: Cache und Fehlerliste leeren. */
export function resetDataCacheForTests(): void {
  cache.clear();
  failed.clear();
  running = null;
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
  const res = await fetchText(path, true);
  if (!res) return null;
  if (res.contentType.includes("text/html") || /^\s*</.test(res.text)) return null;
  return parseText(path, res.text, schema);
}

/** Woche als Bezug für Wochenwähler und Hash (#tipps/2026-2-10). */
export interface WeekRef {
  season: number;
  seasonType: number;
  week: number;
}

export const weekKey = (r: WeekRef): string => `${r.season}-${r.seasonType}-${String(r.week).padStart(2, "0")}`;

/**
 * Hash einer Ansicht mit Woche und Spiel. Die aktuelle Woche steht nicht im Hash, damit eine Home Bildschirm App
 * nach dem Wochenwechsel (D055) die neue Woche zeigt: #tipps/401873037 statt #tipps/2026-2-09/401873037.
 */
export function viewHash(view: string, ref: WeekRef | null, current: WeekRef | null, gameId: string | null = null): string {
  const parts = [`#${view}`];
  if (ref && !(current && sameRef(ref, current))) parts.push(weekKey(ref));
  if (gameId) parts.push(gameId);
  return parts.join("/");
}

/** Liest Woche und Spiel aus dem Hash Argument. Ohne Woche ("401873037") gilt die aktuelle Woche. */
export function parseViewArg(arg: string | null | undefined): { week: string | null; game: string | null } {
  if (!arg) return { week: null, game: null };
  const [first = "", second = ""] = arg.split("/");
  if (parseWeekKey(first)) return { week: first, game: second || null };
  return { week: null, game: first || null };
}

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

/**
 * Liegt die Woche vor der ersten Woche im Wochenindex, also vor dem Start der App? Dann gibt es keine Dateien
 * und die App fragt sie gar nicht erst ab (keine 404 in der Konsole). Ohne Index nie.
 */
export function beforeAppStart(index: WeeksIndex | null, ref: WeekRef): boolean {
  const first = index?.weeks[0];
  return Boolean(first) && compareRef(ref, first!) < 0;
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
  if (beforeAppStart(nav.index, nav.ref)) return null;
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
  /** Nur für das Kürzel des Hauptnutzers (D058), null wenn standings.json fehlt oder ungültig ist. */
  standings: StandingsFile | null;
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
  const tipsPath = beforeAppStart(nav.index, ref) && nav.phase !== "aktuell"
    ? null
    : (paths.tipsFile ?? (nav.phase === "aktuell" ? tipsFilePath(ref.season, ref.seasonType, ref.week) : null));
  const [week, teams, standings, tips, injuries, news] = await Promise.all([
    loadWeekFile(nav),
    loadJson("teams.json", TeamsFileSchema),
    loadStandingsOrNull(),
    tipsPath ? loadOptionalJson(tipsPath, TipsFileSchema) : Promise.resolve(null),
    // Ausfälle und News sind Zusatz: Fehler hier dürfen die Tippliste nie blockieren
    // Der Wächter schreibt Ausfälle der aktuellen und der nächsten Woche (D050), darum auch die angezeigte
    // kommende Woche. Fehlt die Datei, bleibt es still bei null
    nav.phase === "vergangen" ? Promise.resolve(null) : loadInjuries(ref),
    nav.phase === "vergangen" ? Promise.resolve(null) : loadNews(),
  ]);
  return { ...nav, week, teams, standings, tips, injuries, news };
}

/** standings.json für das Kürzel des Hauptnutzers (D058), null wenn sie fehlt oder nicht lesbar ist. */
export async function loadStandingsOrNull(): Promise<StandingsFile | null> {
  try {
    return await loadJson("standings.json", StandingsFileSchema);
  } catch {
    return null;
  }
}

export interface ReviewWeek {
  ref: WeekRef;
  /** Pfad der Bilanz, null wenn die Woche noch keine hat. */
  path: string | null;
}

export interface ReviewData {
  /** Alle Wochen für den Wochenwähler, aufsteigend (D044 geändert: wie Tipps und Spiele). */
  weeks: ReviewWeek[];
  ref: WeekRef;
  /** Standardwoche: neueste Woche mit Bilanz bis zur aktuellen Woche. */
  home: WeekRef;
  current: WeekRef | null;
  phase: WeekPhase;
  path: string | null;
  /** null, wenn die Woche keine Bilanz hat. */
  review: ReviewFile | null;
  /** null, wenn die Wochendatei fehlt. Dann fehlen Kürzel pro Spiel. */
  week: WeekFile | null;
  teams: TeamsFile;
  /** Nur für das Kürzel des Hauptnutzers (D058), null wenn standings.json fehlt. */
  standings: StandingsFile | null;
  /** Woche liegt vor dem Start der App, es gibt keine Daten. */
  beforeStart?: boolean;
}

/** Liste der Bilanzen, null wenn noch keine existiert. */
export async function loadReviewIndex(): Promise<string[] | null> {
  return loadOptionalJson(REVIEW_INDEX_PATH, ReviewIndexSchema);
}

/** Wochen aus dem Wochenindex plus Bilanzen aus reviews/index.json, aufsteigend. Beide Dateien dürfen fehlen. */
export async function loadReviewWeeks(): Promise<ReviewWeek[]> {
  const [weeksIndex, reviewIndex] = await Promise.all([loadWeeksIndex(), loadReviewIndex()]);
  const map = new Map<string, ReviewWeek>();
  for (const path of reviewIndex ?? []) {
    const ref = parseWeekKey(/(\d{4}-\d-\d{2})\.json$/.exec(path)?.[1]);
    if (ref) map.set(weekKey(ref), { ref, path });
  }
  for (const w of weeksIndex?.weeks ?? []) {
    const ref = { season: w.season, seasonType: w.seasonType, week: w.week };
    const key = weekKey(ref);
    map.set(key, { ref, path: w.reviewFile ?? map.get(key)?.path ?? null });
  }
  return [...map.values()].sort((a, b) => compareRef(a.ref, b.ref));
}

/** Neueste Woche mit Bilanz bis zur aktuellen Woche, sonst die neueste mit Bilanz, sonst die aktuelle. */
function homeWeek(weeks: ReviewWeek[], current: WeekRef | null): WeekRef | null {
  const withReview = weeks.filter((w) => w.path);
  const upTo = current ? withReview.filter((w) => compareRef(w.ref, current) <= 0) : withReview;
  return (upTo[upTo.length - 1] ?? withReview[withReview.length - 1])?.ref ?? current ?? weeks[weeks.length - 1]?.ref ?? null;
}

/** Bilanzseite einer Woche. null, wenn es weder Wochen noch Bilanzen gibt. */
export async function loadReviewPage(requested: WeekRef | null): Promise<ReviewData | null> {
  const [weeks, currentFile, weeksIndex] = await Promise.all([loadReviewWeeks(), loadCurrent(), loadWeeksIndex()]);
  const current = currentFile ? currentRef(currentFile) : null;
  if (current && weeks.length > 0 && !weeks.some((w) => sameRef(w.ref, current))) {
    weeks.push({ ref: current, path: null });
    weeks.sort((a, b) => compareRef(a.ref, b.ref));
  }
  const home = homeWeek(weeks, current);
  if (!home) return null;
  const ref = requested ?? home;
  const entry = weeks.find((w) => sameRef(w.ref, ref));
  if (!entry) weeks.splice(weeks.findIndex((w) => compareRef(w.ref, ref) > 0) >>> 0, 0, { ref, path: null });
  const path = entry?.path ?? null;
  const [review, teams, standings, week] = await Promise.all([
    path ? loadJson(path, ReviewFileSchema) : Promise.resolve(null),
    loadJson("teams.json", TeamsFileSchema),
    loadStandingsOrNull(),
    beforeAppStart(weeksIndex, ref)
      ? Promise.resolve(null)
      : loadOptionalJson(weekFilePath(ref.season, ref.seasonType, ref.week), WeekFileSchema).catch(() => null),
  ]);
  const phase: WeekPhase = current ? phaseOf(ref, current) : "vergangen";
  return { weeks, ref, home, current, phase, path, review, week, teams, standings, beforeStart: beforeAppStart(weeksIndex, ref) };
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

// ---------- Fakten: ESPN FPI und Pick'em (D050) ----------

/**
 * Erste Woche mit Dateien unter data/fpi und data/picks. Frühere Wochen werden nicht abgefragt, damit keine
 * vermeidbaren 404 Abrufe entstehen.
 */
export const FACTS_FIRST_WEEK: WeekRef = { season: 2026, seasonType: 2, week: 8 };

export interface FactsData {
  /** null, wenn die Datei fehlt oder ungültig ist. */
  fpi: FpiFile | null;
  picks: PicksFile | null;
  /** Ausfälle der Woche für die Signale einer Abweichung (D052), null wenn die Datei fehlt. */
  injuries: InjuriesFile | null;
}

/**
 * Gibt es für die Woche FPI, Picks oder Ausfall Dateien? Wächter und Picks Job schreiben nur die aktuelle und die
 * nächste Woche, ab FACTS_FIRST_WEEK. Spätere Wochen werden nicht abgefragt (keine 404 in der Konsole).
 */
export async function factsMayExist(ref: WeekRef): Promise<boolean> {
  if (compareRef(ref, FACTS_FIRST_WEEK) < 0) return false;
  let current: CurrentFile;
  try {
    current = await loadJson("current.json", CurrentFileSchema);
  } catch {
    return true;
  }
  const last = nextTipWeeks({ season: current.season, seasonType: current.seasonType, week: current.week }, 1)[0] ?? current;
  return compareRef(ref, last) <= 0;
}

const optionalOrNull = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> =>
  loadOptionalJson(path, schema).catch(() => null);

/**
 * FPI und Tippverteilung einer Woche. Beide Dateien sind Zusatz: fehlen sie oder sind sie ungültig, bleibt
 * der jeweilige Teil leer, nie eine Fehlermeldung. Nur für die angezeigte Woche, kein Vorladen.
 */
export async function loadFactsData(ref: WeekRef): Promise<FactsData> {
  if (!(await factsMayExist(ref))) return { fpi: null, picks: null, injuries: null };
  const [fpi, picks, injuries] = await Promise.all([
    optionalOrNull(fpiFilePath(ref.season, ref.seasonType, ref.week), FpiFileSchema),
    optionalOrNull(picksFilePath(ref.season, ref.seasonType, ref.week), PicksFileSchema),
    optionalOrNull(injuriesFilePath(ref.season, ref.seasonType, ref.week), InjuriesFileSchema),
  ]);
  // Eine Datei einer anderen Woche gilt als fehlend
  const same = (f: WeekRef | null) => f !== null && sameRef(f, ref);
  return { fpi: same(fpi) ? fpi : null, picks: same(picks) ? picks : null, injuries: same(injuries) ? injuries : null };
}

/**
 * Ausfälle der Woche, nur wo der Wächter schreibt (aktuelle und nächste Woche, ab FACTS_FIRST_WEEK). Fehlt die
 * Datei (404) oder ist sie ungültig, kommt still null.
 */
async function loadInjuries(ref: WeekRef): Promise<InjuriesFile | null> {
  if (!(await factsMayExist(ref))) return null;
  const file = await optionalOrNull(injuriesFilePath(ref.season, ref.seasonType, ref.week), InjuriesFileSchema);
  return file && sameRef(file, ref) ? file : null;
}

/** Fakten der Woche, null solange geladen wird oder wenn ref null ist. Lädt nach Hintergrundprüfung neu. */
export function useFactsData(ref: WeekRef | null): FactsData | null {
  const version = useDataVersion();
  const key = ref ? weekKey(ref) : null;
  const [state, setState] = useState<{ key: string; data: FactsData } | null>(null);
  useEffect(() => {
    if (!ref || !key) return;
    let active = true;
    loadFactsData(ref)
      .then((data) => {
        if (active) setState({ key, data });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // ref ändert sich mit key
  }, [key, version]);
  return state && state.key === key ? state.data : null;
}
