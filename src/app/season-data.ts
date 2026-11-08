// Loader der Saisonauswertung (D050, D058). Eigene Datei neben data.ts: lädt alle Bilanz, Tipp und FPI Dateien
// einer Saison und rechnet die Auswertung mit buildSeasonSummary. Grundlage ist die Wochenliste aus
// data/weeks/index.json. Fehlende Zusatzdateien (FPI, einzelne Wochen) blockieren die Ansicht nie.
// Dazu die Kachel Deine Saison in den Tipps: nur die Bilanzen der Saison, mit der eigenen Wahl.
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { FpiFileSchema, fpiFilePath, type FpiFile } from "../core/fpi";
import { ReviewFileSchema, type ReviewFile } from "../core/review-schema";
import { buildSeasonSummary, fpiPickProbLookup, type SeasonSummary } from "../core/season";
import { TipsFileSchema, type StandingsFile, type TipsFile } from "../core/tips-schema";
import {
  FACTS_FIRST_WEEK,
  compareRef,
  loadCurrent,
  loadOptionalDataFile,
  loadStandingsOrNull,
  loadWeeksIndex,
  sameRef,
  useDataVersion,
  weekKey,
  type WeekRef,
} from "./data";
import { applyChoicesToReview, useChoicesFor, type Choices } from "./player";

// Alle Abrufe laufen über den Sitzungscache aus data.ts. So erneuern Aktualisieren, Rückkehr in die App und
// die 5 Minuten Prüfung (D045) auch die Saisondaten, und ein geänderter Inhalt lädt die Ansicht ohne Leerzustand neu.

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
  /** Nur für das Kürzel des Hauptnutzers (D058), null wenn standings.json fehlt. */
  standings: StandingsFile | null;
  summary: SeasonSummary;
}

/** Saisondaten der Saison von current.json, sonst der neuesten Saison im Wochenindex. null ohne Wochenindex. */
export async function loadSeasonData(): Promise<SeasonData | null> {
  const [index, current] = await Promise.all([loadWeeksIndex(), loadCurrent()]);
  if (!index || index.weeks.length === 0) return null;
  const season = current?.season ?? index.weeks[index.weeks.length - 1]!.season;
  const entries = index.weeks.filter((w) => w.season === season).sort(compareRef);
  const [standings, perWeek] = await Promise.all([
    loadStandingsOrNull(),
    Promise.all(
      entries.map(async (w) => {
        const [review, tips, fpi] = await Promise.all([
          w.reviewFile ? optional(w.reviewFile, ReviewFileSchema) : Promise.resolve(null),
          w.tipsFile ? optional(w.tipsFile, TipsFileSchema) : Promise.resolve(null),
          // FPI nur für Wochen mit Bilanz ab der ersten FPI Datei, nur dort fliesst es in die Auswertung ein
          w.reviewFile && compareRef(w, FACTS_FIRST_WEEK) >= 0 ? optional(fpiFilePath(w.season, w.seasonType, w.week), FpiFileSchema) : Promise.resolve(null),
        ]);
        return { ref: { season: w.season, seasonType: w.seasonType, week: w.week }, review, tips, fpi };
      }),
    ),
  ]);
  const reviews = perWeek.flatMap((w) => (w.review ? [w.review] : []));
  const tips = perWeek.flatMap((w) => (w.tips ? [w.tips] : []));
  const fpi = perWeek.flatMap((w) => (w.fpi ? [w.fpi] : []));
  const summary = buildSeasonSummary({ season, reviews, tips, fpiPickProb: fpi.length > 0 ? fpiPickProbLookup(fpi) : undefined });
  return {
    season,
    current: current ? { season: current.season, seasonType: current.seasonType, week: current.week } : null,
    weeks: perWeek.map((w) => w.ref),
    reviews,
    tips,
    fpi,
    standings,
    summary,
  };
}

export const seasonWeekHref = (ref: WeekRef) => `#bilanz/${weekKey(ref)}`;

// ---------- Deine Saison in den Tipps (D058) ----------

export interface WeekTally {
  /** Richtige App Tipps. */
  right: number;
  /** Gewertete App Tipps: entschieden, Unentschieden zählt als falsch. */
  scored: number;
}

/** Bilanzen einer Saison aus dem Wochenindex. Fehlende oder ungültige Dateien fallen weg. */
export async function loadSeasonReviews(season: number): Promise<ReviewFile[]> {
  const index = await loadWeeksIndex();
  const entries = (index?.weeks ?? []).filter((w) => w.season === season && w.reviewFile);
  const files = await Promise.all(entries.map((w) => optional(w.reviewFile!, ReviewFileSchema)));
  return files.flatMap((f) => (f && f.season === season ? [f] : []));
}

/**
 * Saison bis jetzt aus den Bilanzen mit der eigenen Wahl (D057), wie in der Bilanz. Die angezeigte Woche zählt
 * aus shownWeek (Tippliste mit Live Endständen), ihre Bilanz fällt dafür weg. Ohne shownWeek zählt die Bilanz.
 */
export function ownSeasonTally(
  reviews: readonly ReviewFile[],
  choicesByWeek: ReadonlyMap<string, Choices>,
  shownRef: WeekRef | null,
  shownWeek: WeekTally | null,
): WeekTally {
  let right = 0;
  let scored = 0;
  for (const r of reviews) {
    if (shownWeek && shownRef && sameRef(r, shownRef)) continue;
    const c = choicesByWeek.get(weekKey(r));
    const own = c ? applyChoicesToReview(r, c).review : r;
    right += own.games.filter((g) => g.correct === true).length;
    scored += own.games.filter((g) => g.correct !== null).length;
  }
  if (shownWeek) {
    right += shownWeek.right;
    scored += shownWeek.scored;
  }
  return { right, scored };
}

/** Bilanzen der Saison mit der eigenen Wahl pro Woche. null solange geladen wird. Lädt nach Hintergrundprüfung neu. */
export function useSeasonReviews(
  season: number,
  player: string,
): { reviews: ReviewFile[]; choices: ReadonlyMap<string, Choices> } | null {
  const version = useDataVersion();
  const [state, setState] = useState<{ season: number; reviews: ReviewFile[] } | null>(null);
  useEffect(() => {
    let active = true;
    loadSeasonReviews(season)
      .then((reviews) => active && setState({ season, reviews }))
      .catch(() => active && setState({ season, reviews: [] }));
    return () => {
      active = false;
    };
  }, [season, version]);
  const reviews = state && state.season === season ? state.reviews : null;
  const refs = useMemo(() => (reviews ?? []).map((r) => ({ season: r.season, seasonType: r.seasonType, week: r.week })), [reviews]);
  const choices = useChoicesFor(player, refs);
  return useMemo(() => (reviews ? { reviews, choices } : null), [reviews, choices]);
}
