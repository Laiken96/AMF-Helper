// ESPN FPI Matchup Predictor als dritte Meinung im Schattenvergleich (D050). Beeinflusst nie den Tipp (D009, D024).
// Quelle ist predictor im ESPN Summary, das der Ausfall Wächter ohnehin lädt. Schreiber: jobs/watch.ts.
// Eigene Datei data/fpi/<saison>-<typ>-<woche>.json mit eigener Version, damit die Ausfall Datei und ihr
// Grundstand unberührt bleiben und ein fehlender oder kaputter predictor nie den Wächter stört.
import { z } from "zod";
import type { Game } from "./schema";

export const FPI_SCHEMA_VERSION = 1 as const;

// gameProjection kommt als Text in Prozent, z. B. "47.8". Zahl wird ebenfalls akzeptiert.
const ProjectionSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v.trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    ctx.addIssue({ code: "custom", message: `ungültige gameProjection ${String(v)}` });
    return z.NEVER;
  }
  return n;
});

const PredictorTeamSchema = z.looseObject({ id: z.string(), gameProjection: ProjectionSchema });

export const EspnPredictorSchema = z.looseObject({
  homeTeam: PredictorTeamSchema,
  awayTeam: PredictorTeamSchema,
});

export const FpiGameSchema = z.object({
  gameId: z.string(),
  kickoffUtc: z.string().datetime(),
  homeId: z.string(),
  awayId: z.string(),
  pHome: z.number().min(0).max(1), // gameProjection Heimteam durch 100
  pAway: z.number().min(0).max(1), // gameProjection Gastteam durch 100, Summe kann wegen Unentschieden unter 1 liegen
  fetchedAt: z.string().datetime(), // Zeitpunkt der letzten inhaltlichen Änderung
  locked: z.boolean(), // ab Kickoff oder sobald das Spiel nicht mehr geplant ist, danach eingefroren
});
export type FpiGame = z.infer<typeof FpiGameSchema>;

export const FpiFileSchema = z.object({
  schemaVersion: z.literal(FPI_SCHEMA_VERSION),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  updatedAt: z.string().datetime(),
  games: z.array(FpiGameSchema), // nur Spiele, für die ESPN einen predictor geliefert hat
});
export type FpiFile = z.infer<typeof FpiFileSchema>;

export function fpiFilePath(season: number, seasonType: number, week: number): string {
  return `fpi/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}

const round4 = (p: number) => Math.round(p * 10_000) / 10_000;

export interface FpiProjection {
  pHome: number;
  pAway: number;
}

/**
 * Liest den predictor aus einem rohen Summary. Null, wenn er fehlt, ungültig ist oder die Team IDs nicht
 * zum Spiel passen. Wirft nie, damit der Wächter unabhängig davon läuft.
 */
export function fpiFromSummary(raw: unknown, game: Pick<Game, "homeId" | "awayId">): FpiProjection | null {
  if (typeof raw !== "object" || raw === null || !("predictor" in raw)) return null;
  const r = EspnPredictorSchema.safeParse((raw as { predictor: unknown }).predictor);
  if (!r.success) return null;
  const { homeTeam, awayTeam } = r.data;
  if (homeTeam.id !== game.homeId || awayTeam.id !== game.awayId) return null;
  return { pHome: round4(homeTeam.gameProjection / 100), pAway: round4(awayTeam.gameProjection / 100) };
}

export interface BuildFpiInput {
  season: number;
  seasonType: number;
  week: number;
  games: ReadonlyArray<Pick<Game, "id" | "kickoffUtc" | "homeId" | "awayId" | "status">>;
  /** Frisch gelesene Projektionen je Spiel ID. Fehlende Spiele behalten den bisherigen Stand. */
  fetched: ReadonlyMap<string, FpiProjection>;
  existing: FpiFile | null;
  now: string;
}

/**
 * Baut die FPI Datei. Ab Kickoff oder sobald ein Spiel nicht mehr geplant ist, bleibt der letzte Stand
 * eingefroren. Unveränderte Werte behalten ihren Zeitstempel.
 */
export function buildFpiFile(input: BuildFpiInput): FpiFile {
  const { now } = input;
  const prev = new Map((input.existing?.games ?? []).map((g) => [g.gameId, g]));
  const games: FpiGame[] = [];
  const sorted = [...input.games].sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.id.localeCompare(b.id));
  for (const g of sorted) {
    const old = prev.get(g.id);
    const locked = Date.parse(now) >= Date.parse(g.kickoffUtc) || g.status !== "scheduled";
    if (old && (old.locked || locked)) {
      games.push({ ...old, locked: true });
      continue;
    }
    const fresh = locked ? undefined : input.fetched.get(g.id);
    if (fresh) {
      const same = old && old.pHome === fresh.pHome && old.pAway === fresh.pAway && old.homeId === g.homeId && old.awayId === g.awayId;
      games.push({
        gameId: g.id,
        kickoffUtc: g.kickoffUtc,
        homeId: g.homeId,
        awayId: g.awayId,
        pHome: fresh.pHome,
        pAway: fresh.pAway,
        fetchedAt: same ? old.fetchedAt : now,
        locked: false,
      });
    } else if (old) games.push({ ...old, kickoffUtc: g.kickoffUtc });
  }
  return FpiFileSchema.parse({
    schemaVersion: FPI_SCHEMA_VERSION,
    season: input.season,
    seasonType: input.seasonType,
    week: input.week,
    updatedAt: now,
    games,
  });
}

/** Vergleicht zwei FPI Dateien ohne updatedAt. */
export function sameFpiContent(a: FpiFile, b: FpiFile): boolean {
  const strip = (f: FpiFile) => JSON.stringify({ ...f, updatedAt: "" });
  return strip(a) === strip(b);
}
