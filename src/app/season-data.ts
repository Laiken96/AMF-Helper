// Loader der Saisonauswertung (D050). Eigene Datei neben data.ts: lädt alle Bilanz, Tipp und FPI Dateien einer
// Saison und rechnet die Auswertung mit buildSeasonSummary. Grundlage ist die Wochenliste aus
// data/weeks/index.json. Fehlende Zusatzdateien (FPI, einzelne Wochen) blockieren die Ansicht nie.
import type { z } from "zod";
import { FpiFileSchema, fpiFilePath, type FpiFile } from "../core/fpi";
import { ReviewFileSchema, StandingsHistorySchema, type ReviewFile, type StandingsHistory } from "../core/review-schema";
import { WeekFileSchema } from "../core/schema";
import { buildSeasonSummary, fpiPickProbLookup, type SeasonSummary } from "../core/season";
import { StandingsFileSchema, TipsFileSchema, type StandingsFile, type TipsFile } from "../core/tips-schema";
import {
  FACTS_FIRST_WEEK,
  compareRef,
  loadCurrent,
  loadDataFile,
  loadOptionalDataFile,
  loadWeeksIndex,
  weekKey,
  type WeekRef,
} from "./data";
import { readStoredPlayer } from "./player";

/** Gewählter Spieler aus dem Onboarding (player.ts), nur gültige Kürzel. null ohne Wahl. */
export function storedPlayer(): string | null {
  const v = readStoredPlayer();
  return v && /^[A-Z]{2,3}$/.test(v) ? v : null;
}

// Alle Abrufe laufen über den Sitzungscache aus data.ts. So erneuern Aktualisieren, Rückkehr in die App und
// die 5 Minuten Prüfung (D045) auch die Saisondaten, und ein geänderter Inhalt lädt die Ansicht ohne Leerzustand neu.
const load = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> => loadDataFile(path, schema);

/** Optionale Datei: Fehler zählen wie eine fehlende Datei. */
const optional = <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> =>
  loadOptionalDataFile(path, schema).catch(() => null);

export interface SeasonData {
  season: number;
  current: WeekRef | null;
  weeks: WeekRef[]; // Wochen der Saison aus dem Wochenindex, aufsteigend
  reviews: ReviewFile[];
  tips: TipsFile[];
  fpi: FpiFile[];
  standings: StandingsFile;
  history: StandingsHistory;
  /** Spielzahl pro Regular Season Woche aus Bilanz oder Wochendatei. */
  weekGameCounts: Map<number, number>;
  summary: SeasonSummary;
}

/** Saisondaten der Saison von current.json, sonst der neuesten Saison im Wochenindex. null ohne Wochenindex. */
export async function loadSeasonData(): Promise<SeasonData | null> {
  const [index, current] = await Promise.all([loadWeeksIndex(), loadCurrent()]);
  if (!index || index.weeks.length === 0) return null;
  const season = current?.season ?? index.weeks[index.weeks.length - 1]!.season;
  const entries = index.weeks.filter((w) => w.season === season).sort(compareRef);
  const [standings, history, perWeek] = await Promise.all([
    load("standings.json", StandingsFileSchema) as Promise<StandingsFile>,
    load("standings-history.json", StandingsHistorySchema) as Promise<StandingsHistory>,
    Promise.all(
      entries.map(async (w) => {
        const [review, tips, fpi] = await Promise.all([
          w.reviewFile ? optional(w.reviewFile, ReviewFileSchema) : Promise.resolve(null),
          w.tipsFile ? optional(w.tipsFile, TipsFileSchema) : Promise.resolve(null),
          // FPI nur für Wochen mit Bilanz ab der ersten FPI Datei, nur dort fliesst es in die Auswertung ein
          w.reviewFile && compareRef(w, FACTS_FIRST_WEEK) >= 0 ? optional(fpiFilePath(w.season, w.seasonType, w.week), FpiFileSchema) : Promise.resolve(null),
        ]);
        return { ref: { season: w.season, seasonType: w.seasonType, week: w.week }, review, tips, fpi, weekFile: w.weekFile };
      }),
    ),
  ]);
  const reviews = perWeek.flatMap((w) => (w.review ? [w.review] : []));
  const tips = perWeek.flatMap((w) => (w.tips ? [w.tips] : []));
  const fpi = perWeek.flatMap((w) => (w.fpi ? [w.fpi] : []));
  const weekGameCounts = new Map<number, number>();
  for (const w of perWeek) {
    if (w.ref.seasonType !== 2) continue;
    const n = w.review?.games.length ?? w.tips?.tips.length;
    if (n !== undefined) weekGameCounts.set(w.ref.week, n);
  }
  // Wochen bis zum Ranglistenstand ohne Bilanz und Tipps: Spielzahl aus der Wochendatei, falls vorhanden
  const missing = perWeek.filter((w) => w.ref.seasonType === 2 && !weekGameCounts.has(w.ref.week) && w.ref.week <= standings.asOfWeek);
  const files = await Promise.all(missing.map((w) => optional(w.weekFile, WeekFileSchema)));
  missing.forEach((w, i) => {
    const f = files[i];
    if (f) weekGameCounts.set(w.ref.week, f.games.length);
  });
  const summary = buildSeasonSummary({ season, reviews, tips, fpiPickProb: fpi.length > 0 ? fpiPickProbLookup(fpi) : undefined });
  return {
    season,
    current: current ? { season: current.season, seasonType: current.seasonType, week: current.week } : null,
    weeks: perWeek.map((w) => w.ref),
    reviews,
    tips,
    fpi,
    standings,
    history,
    weekGameCounts,
    summary,
  };
}

export const seasonWeekHref = (ref: WeekRef) => `#bilanz/${weekKey(ref)}`;
