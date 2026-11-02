// Saisonkalender: welche Wochen getippt werden und wie Wochen über die Grenze der Saisontypen aufeinander folgen.
// Reine Logik ohne Imports, damit tips.ts, standings.ts und die Jobs sie ohne Zyklus nutzen können.
// ESPN Saisontypen: 1 Preseason, 2 Regular Season, 3 Postseason, 4 Offseason.
// Postseason Wochen bei ESPN: 1 Wild Card, 2 Divisional, 3 Conference, 4 Pro Bowl, 5 Super Bowl.

/** Wochen der Regular Season. Gleich wie REGULAR_SEASON_WEEKS in tips.ts, ein Test prüft die Gleichheit. */
export const REGULAR_WEEKS = 18;
/** Pro Bowl Woche der Postseason: nur AFC gegen NFC, keine Tipps. */
export const PRO_BOWL_WEEK = 4;
/** Letzte Woche der Postseason (Super Bowl). */
export const LAST_POSTSEASON_WEEK = 5;

export interface WeekRef {
  season: number;
  seasonType: number;
  week: number;
}

/** Reihenfolge innerhalb einer Saison: erst Saisontyp, dann Woche. */
export function weekOrder(k: { seasonType: number; week: number }): number {
  return k.seasonType * 100 + k.week;
}

/**
 * Grund, warum eine Woche ruht, oder null für eine Tippwoche. Ruhende Wochen bekommen keine Wochendatei,
 * keine Tipps und keine Pushes, current.json bleibt auf der letzten Tippwoche.
 */
export function dormantReason(k: { seasonType: number; week: number }): string | null {
  if (k.seasonType === 1) return "Preseason";
  if (k.seasonType === 3 && k.week === PRO_BOWL_WEEK) return "Pro Bowl";
  if (k.seasonType === 2 && k.week >= 1 && k.week <= REGULAR_WEEKS) return null;
  if (k.seasonType === 3 && k.week >= 1 && k.week <= LAST_POSTSEASON_WEEK) return null;
  if (k.seasonType === 4) return "Offseason";
  return `unbekannte Woche Typ ${k.seasonType} Woche ${k.week}`;
}

export function isTipWeek(k: { seasonType: number; week: number }): boolean {
  return dormantReason(k) === null;
}

/**
 * Vorherige Tippwoche derselben Saison. Regular Week 1 hat keine (Start bei 0 Punkten), Postseason Week 1
 * folgt auf Regular Week 18, der Super Bowl auf die Conference Woche (Pro Bowl ohne Tipps).
 */
export function previousTipWeek(k: WeekRef): WeekRef | null {
  if (!isTipWeek(k)) return null;
  if (k.seasonType === 2) return k.week === 1 ? null : { season: k.season, seasonType: 2, week: k.week - 1 };
  if (k.week === 1) return { season: k.season, seasonType: 2, week: REGULAR_WEEKS };
  const w = k.week - 1 === PRO_BOWL_WEEK ? k.week - 2 : k.week - 1;
  return { season: k.season, seasonType: 3, week: w };
}

/**
 * Die nächsten n Tippwochen nach der gegebenen Woche, über die Grenze Regular zu Postseason, ohne Pro Bowl.
 * Aus der Preseason folgen Regular Week 1 und 2. Nach dem Super Bowl und in der Offseason keine.
 */
export function nextTipWeeks(k: WeekRef, n: number): WeekRef[] {
  const out: WeekRef[] = [];
  let cur: WeekRef | null = k.seasonType === 1 ? { season: k.season, seasonType: 2, week: 0 } : k;
  while (cur !== null && out.length < n) {
    cur = nextWeekRaw(cur);
    if (cur !== null && isTipWeek(cur)) out.push(cur);
  }
  return out;
}

function nextWeekRaw(k: WeekRef): WeekRef | null {
  if (k.seasonType === 2) {
    return k.week < REGULAR_WEEKS ? { ...k, week: k.week + 1 } : { season: k.season, seasonType: 3, week: 1 };
  }
  if (k.seasonType === 3 && k.week < LAST_POSTSEASON_WEEK) return { ...k, week: k.week + 1 };
  return null;
}
