// Public Pick Prozente aus ESPN Pick'em (D050). Quelle ist die undokumentierte Gambit API, daher wird nur der
// benötigte Teil geprüft und jede unbekannte Struktur führt zu einem Fehler, den der Job als Warnung behandelt.
// Schreiber: jobs/picks.ts. Leser: später die App. Nur Information, beeinflusst nie den Tipp (D009).
//
// Annahme zum scoringFormatId: ESPN führt pro Spiel Zähler für mehrere Spielformen (am 2026-11-02 gesehen 1, 2,
// 3 und 7). Format 1 hatte mit Abstand die grösste Stichprobe und passt zu den reinen Siegertipps unserer Runde
// (in Week 8 rund 675000 Tipps pro Spiel, Favoriten mit 80 bis 98 Prozent). Formate 3 und 7 sehen nach Tipps
// gegen den Spread aus (nahe 50 Prozent), in Week 9 waren sie leer. Gewählt wird pro Spiel das Format mit der
// grössten Summe der Zähler, das Format steht in der Datei.
import { z } from "zod";
import type { Game } from "./schema";

export const PICKS_SCHEMA_VERSION = 1 as const;

export const PICKEM_BASE = "https://gambit-api.fantasy.espn.com/apis/v1/challenges";

/** URL der Pick'em Challenge einer Saison für eine Woche der Regular Season. */
export function pickemUrl(season: number, week: number): string {
  return `${PICKEM_BASE}/nfl-pickem-${season}?view=chui_default&scoringPeriodId=${week}`;
}

const MappingSchema = z.looseObject({ type: z.string(), value: z.string() });

const ChoiceCounterSchema = z.looseObject({
  count: z.number().int().min(0),
  scoringFormatId: z.number().int(),
});

const OutcomeSchema = z.looseObject({
  id: z.string(),
  abbrev: z.string().optional(),
  subType: z.string().optional(), // HOME oder AWAY
  mappings: z.array(MappingSchema).optional().default([]),
  choiceCounters: z.array(ChoiceCounterSchema).optional().default([]),
});

const PropositionSchema = z.looseObject({
  id: z.string(),
  scoringPeriodId: z.number().int().optional(),
  mappings: z.array(MappingSchema).optional().default([]),
  possibleOutcomes: z.array(OutcomeSchema),
});

export const PickemResponseSchema = z.looseObject({
  key: z.string().optional(),
  propositions: z.array(PropositionSchema),
});
export type PickemResponse = z.infer<typeof PickemResponseSchema>;
type Proposition = z.infer<typeof PropositionSchema>;

export const GamePicksSchema = z.object({
  gameId: z.string(), // ESPN Event ID wie in der Wochendatei
  homeId: z.string(),
  awayId: z.string(),
  homeShare: z.number().min(0).max(1), // Anteil der Tipps auf das Heimteam
  awayShare: z.number().min(0).max(1),
  total: z.number().int().min(1), // Stichprobe im gewählten Format
  scoringFormatId: z.number().int(),
  fetchedAt: z.string().datetime(), // letzte Änderung der Anteile
  locked: z.boolean(), // ab Kickoff oder sobald das Spiel nicht mehr geplant ist, danach eingefroren
});
export type GamePicks = z.infer<typeof GamePicksSchema>;

export const PicksFileSchema = z.object({
  schemaVersion: z.literal(PICKS_SCHEMA_VERSION),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  updatedAt: z.string().datetime(),
  source: z.literal("espn-pickem"),
  games: z.array(GamePicksSchema), // nur Spiele, die ESPN zuordnen liess
});
export type PicksFile = z.infer<typeof PicksFileSchema>;

export function picksFilePath(season: number, seasonType: number, week: number): string {
  return `picks/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}

export type PickemParse = { ok: true; response: PickemResponse } | { ok: false; error: string };

export function parsePickem(raw: unknown): PickemParse {
  const r = PickemResponseSchema.safeParse(raw);
  return r.success ? { ok: true, response: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

const mapping = (ms: ReadonlyArray<{ type: string; value: string }>, type: string) => ms.find((m) => m.type === type)?.value;

/** Anteile auf 3 Stellen (0.1 Prozent). */
const round3 = (p: number) => Math.round(p * 1000) / 1000;

/**
 * Ab dieser Bewegung des Heimanteils (0.5 Prozentpunkte) gilt ein Anteil als geändert (D057). Bei rund 650000
 * Tipps pro Spiel bewegt sich die dritte Stelle fast stündlich, das ergab bei jedem Lauf von data.yml eine neue
 * Datei und einen Pages Neubau. Die App zeigt ganze Prozent. Verglichen wird mit dem gespeicherten Wert, so
 * kommt auch eine langsame Drift an.
 */
export const PICKS_MIN_CHANGE = 0.005;

export interface ShareResult {
  homeShare: number;
  awayShare: number;
  total: number;
  scoringFormatId: number;
}

/**
 * Anteile eines Spiels aus einer Proposition. Teams über COMPETITOR_ID, ersatzweise über subType.
 * Null, wenn die Teams nicht passen oder kein Format Tipps hat.
 */
export function sharesFor(prop: Proposition, game: Pick<Game, "homeId" | "awayId">): ShareResult | null {
  if (prop.possibleOutcomes.length !== 2) return null;
  const side = (o: Proposition["possibleOutcomes"][number]): "home" | "away" | null => {
    const id = mapping(o.mappings, "COMPETITOR_ID");
    if (id !== undefined) return id === game.homeId ? "home" : id === game.awayId ? "away" : null;
    if (o.subType === "HOME") return "home";
    if (o.subType === "AWAY") return "away";
    return null;
  };
  const home = prop.possibleOutcomes.find((o) => side(o) === "home");
  const away = prop.possibleOutcomes.find((o) => side(o) === "away");
  if (!home || !away || home === away) return null;
  const counts = new Map<number, { home: number; away: number }>();
  for (const [o, key] of [
    [home, "home"],
    [away, "away"],
  ] as const) {
    for (const c of o.choiceCounters) {
      const e = counts.get(c.scoringFormatId) ?? { home: 0, away: 0 };
      e[key] += c.count;
      counts.set(c.scoringFormatId, e);
    }
  }
  let best: { id: number; home: number; away: number } | null = null;
  for (const [id, e] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (e.home + e.away > 0 && (!best || e.home + e.away > best.home + best.away)) best = { id, ...e };
  }
  if (!best) return null;
  const total = best.home + best.away;
  const homeShare = round3(best.home / total);
  return { homeShare, awayShare: round3(1 - homeShare), total, scoringFormatId: best.id };
}

export interface BuildPicksInput {
  season: number;
  seasonType: number;
  week: number;
  games: ReadonlyArray<Pick<Game, "id" | "kickoffUtc" | "homeId" | "awayId" | "status">>;
  response: PickemResponse;
  existing: PicksFile | null;
  now: string;
}

export interface BuildPicksResult {
  file: PicksFile;
  /** Spiel IDs der Woche ohne passende Proposition oder ohne Tipps. */
  unmatched: string[];
}

/**
 * Ordnet die Propositions den Spielen der Woche zu (EVENT_ID, ersatzweise COMPETITION_ID). Propositions
 * einer anderen Woche fallen weg. Gesperrte Spiele behalten den letzten Stand vor Kickoff, ein beim ersten
 * Lauf schon begonnenes Spiel übernimmt die Zähler, die ESPN mit dem Tippschluss eingefroren hat. Anteile, die sich
 * um weniger als PICKS_MIN_CHANGE bewegt haben, behalten den bisherigen Eintrag samt fetchedAt und total, damit
 * die Datei nur bei echter Änderung neu geschrieben wird.
 */
export function buildPicksFile(input: BuildPicksInput): BuildPicksResult {
  const { now } = input;
  const byEvent = new Map<string, Proposition>();
  for (const p of input.response.propositions) {
    if (p.scoringPeriodId !== undefined && p.scoringPeriodId !== input.week) continue;
    const ev = mapping(p.mappings, "EVENT_ID") ?? mapping(p.mappings, "COMPETITION_ID");
    if (ev !== undefined) byEvent.set(ev, p);
  }
  const prev = new Map((input.existing?.games ?? []).map((g) => [g.gameId, g]));
  const games: GamePicks[] = [];
  const unmatched: string[] = [];
  const sorted = [...input.games].sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.id.localeCompare(b.id));
  for (const g of sorted) {
    const old = prev.get(g.id);
    const locked = Date.parse(now) >= Date.parse(g.kickoffUtc) || g.status !== "scheduled";
    if (old && (old.locked || locked)) {
      games.push({ ...old, locked: true });
      continue;
    }
    const prop = byEvent.get(g.id);
    const shares = prop ? sharesFor(prop, g) : null;
    if (!shares) {
      unmatched.push(g.id);
      if (old) games.push(old);
      continue;
    }
    const same =
      old !== undefined &&
      Math.abs(old.homeShare - shares.homeShare) < PICKS_MIN_CHANGE - 1e-9 &&
      old.scoringFormatId === shares.scoringFormatId &&
      old.homeId === g.homeId &&
      old.awayId === g.awayId;
    games.push(
      same
        ? old
        : { gameId: g.id, homeId: g.homeId, awayId: g.awayId, ...shares, fetchedAt: now, locked },
    );
  }
  const file = PicksFileSchema.parse({
    schemaVersion: PICKS_SCHEMA_VERSION,
    season: input.season,
    seasonType: input.seasonType,
    week: input.week,
    updatedAt: now,
    source: "espn-pickem",
    games,
  });
  return { file, unmatched };
}

/** Vergleicht zwei Dateien ohne updatedAt. */
export function samePicksContent(a: PicksFile, b: PicksFile): boolean {
  const strip = (f: PicksFile) => JSON.stringify({ ...f, updatedAt: "" });
  return strip(a) === strip(b);
}
