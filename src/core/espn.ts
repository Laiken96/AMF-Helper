// ESPN Scoreboard Adapter. Wandelt die inoffizielle ESPN JSON API in den eigenen Datenvertrag um.
// Wird von Jobs und App genutzt, daher kein Node spezifischer Code. Siehe D002 und D006.
import { z } from "zod";
import {
  SCHEMA_VERSION,
  TeamSchema,
  WeekFileSchema,
  type Game,
  type GameStatus,
  type Team,
  type WeekFile,
} from "./schema";
import { OddsSchema, type Odds } from "./tips-schema";

export const ESPN_SCOREBOARD_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export interface ScoreboardQuery {
  season?: number;
  seasonType?: number;
  week?: number;
}

/** URL des Scoreboards. Ohne Parameter liefert ESPN die aktuelle Woche. */
export function scoreboardUrl(query: ScoreboardQuery = {}): string {
  const params = new URLSearchParams();
  if (query.season !== undefined) params.set("dates", String(query.season));
  if (query.seasonType !== undefined) params.set("seasontype", String(query.seasonType));
  if (query.week !== undefined) params.set("week", String(query.week));
  const qs = params.toString();
  return qs ? `${ESPN_SCOREBOARD_BASE}?${qs}` : ESPN_SCOREBOARD_BASE;
}

// Lockeres Schema: nur die benötigten Felder werden geprüft, alles andere bleibt erhalten.

const EspnTeamSchema = z.looseObject({
  id: z.string(),
  abbreviation: z.string(),
  displayName: z.string(),
  shortDisplayName: z.string(),
  logo: z.string().nullish(),
  color: z.string().nullish(),
});

const EspnScoreSchema = z.union([z.string(), z.number()]).nullish();

const EspnCompetitorSchema = z.looseObject({
  homeAway: z.enum(["home", "away"]),
  team: EspnTeamSchema,
  score: EspnScoreSchema,
});

const EspnStatusSchema = z.looseObject({
  type: z.looseObject({
    name: z.string(),
    state: z.enum(["pre", "in", "post"]),
    detail: z.string().nullish(),
    shortDetail: z.string().nullish(),
    completed: z.boolean().nullish(),
  }),
});

const EspnCompetitionSchema = z.looseObject({
  date: z.string().nullish(),
  neutralSite: z.boolean().nullish(),
  venue: z.looseObject({ fullName: z.string().nullish() }).nullish(),
  competitors: z.array(EspnCompetitorSchema).length(2),
  status: EspnStatusSchema.nullish(),
});

const EspnEventSchema = z.looseObject({
  id: z.string(),
  date: z.string(),
  season: z.looseObject({ year: z.number().int(), type: z.number().int() }).nullish(),
  week: z.looseObject({ number: z.number().int() }).nullish(),
  status: EspnStatusSchema,
  competitions: z.array(EspnCompetitionSchema).min(1),
});

export const EspnScoreboardSchema = z.looseObject({
  season: z.looseObject({ year: z.number().int(), type: z.number().int() }),
  week: z.looseObject({
    number: z.number().int(),
    teamsOnBye: z.array(EspnTeamSchema).nullish(),
  }),
  events: z.array(EspnEventSchema),
});
export type EspnScoreboard = z.infer<typeof EspnScoreboardSchema>;

type EspnTeam = z.infer<typeof EspnTeamSchema>;
export type EspnStatus = z.infer<typeof EspnStatusSchema>;

export type ParseResult =
  | { ok: true; week: WeekFile; teams: Team[] }
  | { ok: false; error: string };

export interface ParseOptions {
  /** Zeitpunkt des Abrufs, Standard ist jetzt. */
  fetchedAt?: string;
}

/**
 * Bildet den ESPN Status auf den eigenen Status ab. Ohne Node Importe, die App nutzt die Funktion ebenfalls.
 * Final nur bei state "post" mit completed true oder einem Namen ab STATUS_FINAL. Andere Endzustände wie
 * STATUS_SUSPENDED, STATUS_ABANDONED, STATUS_FORFEIT oder STATUS_DELAYED gelten als verschoben, damit ein
 * Teilstand nicht gewertet wird (D034). Ein später fortgesetztes Spiel wird beim nächsten Lauf final.
 */
export function mapStatus(status: Pick<EspnStatus, "type">): GameStatus {
  const name = status.type.name.toUpperCase();
  if (name === "STATUS_POSTPONED") return "postponed";
  if (name === "STATUS_CANCELED" || name === "STATUS_CANCELLED") return "canceled";
  switch (status.type.state) {
    case "pre":
      return "scheduled";
    case "in":
      return "in_progress";
    case "post":
      return status.type.completed === true || name.startsWith("STATUS_FINAL") ? "final" : "postponed";
  }
}

/** Normalisiert einen ESPN Zeitstempel wie "2026-11-02T01:20Z" auf ISO 8601 UTC mit Sekunden. */
export function normalizeUtc(value: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

function parseScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : null;
}

function cleanLogo(value: string | null | undefined): string | null {
  if (!value) return null;
  return TeamSchema.shape.logo.safeParse(value).success ? value : null;
}

function cleanColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{3,8}$/.test(hex) ? hex : null;
}

function toTeam(t: EspnTeam): Team {
  return {
    id: t.id,
    abbr: t.abbreviation,
    name: t.displayName,
    shortName: t.shortDisplayName,
    logo: cleanLogo(t.logo),
    color: cleanColor(t.color),
  };
}

const byNumericString = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Stabile Reihenfolge der Spiele: Kickoff, dann ID. */
export function compareGames(a: Game, b: Game): number {
  if (a.kickoffUtc !== b.kickoffUtc) return a.kickoffUtc < b.kickoffUtc ? -1 : 1;
  return byNumericString(a.id, b.id);
}

/** Stabile Reihenfolge der Teams nach Kürzel. */
export function compareTeams(a: Team, b: Team): number {
  if (a.abbr !== b.abbr) return a.abbr < b.abbr ? -1 : 1;
  return byNumericString(a.id, b.id);
}

export function parseScoreboard(raw: unknown, options: ParseOptions = {}): ParseResult {
  const parsed = EspnScoreboardSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `ESPN Scoreboard ungültig:\n${z.prettifyError(parsed.error)}` };
  }
  const sb = parsed.data;
  const season = sb.season.year;
  const seasonType = sb.season.type;
  const week = sb.week.number;

  const teams = new Map<string, Team>();
  const games: Game[] = [];

  for (const ev of sb.events) {
    const comp = ev.competitions[0]!;
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) {
      return { ok: false, error: `Spiel ${ev.id}: Heim oder Gastteam fehlt` };
    }
    const kickoffUtc = normalizeUtc(ev.date);
    if (!kickoffUtc) {
      return { ok: false, error: `Spiel ${ev.id}: ungültiges Datum "${ev.date}"` };
    }
    const status = mapStatus(ev.status);
    const preGame = ev.status.type.state === "pre";

    teams.set(home.team.id, toTeam(home.team));
    teams.set(away.team.id, toTeam(away.team));

    games.push({
      id: ev.id,
      // D006: Woche immer aus der Quelle, nie aus dem Datum.
      season: ev.season?.year ?? season,
      seasonType: ev.season?.type ?? seasonType,
      week: ev.week?.number ?? week,
      kickoffUtc,
      homeId: home.team.id,
      awayId: away.team.id,
      status,
      statusDetail: ev.status.type.shortDetail ?? ev.status.type.detail ?? "",
      homeScore: preGame ? null : parseScore(home.score),
      awayScore: preGame ? null : parseScore(away.score),
      venue: comp.venue?.fullName ?? null,
      neutralSite: comp.neutralSite ?? false,
    });
  }

  const byeTeamIds: string[] = [];
  for (const t of sb.week.teamsOnBye ?? []) {
    if (!teams.has(t.id)) teams.set(t.id, toTeam(t));
    byeTeamIds.push(t.id);
  }

  const weekFile = {
    schemaVersion: SCHEMA_VERSION,
    season,
    seasonType,
    week,
    fetchedAt: options.fetchedAt ?? normalizeUtc(new Date().toISOString())!,
    source: "espn" as const,
    games: games.sort(compareGames),
    byeTeamIds: [...new Set(byeTeamIds)].sort(byNumericString),
  };

  const checkedWeek = WeekFileSchema.safeParse(weekFile);
  if (!checkedWeek.success) {
    return { ok: false, error: `Woche verletzt Datenvertrag:\n${z.prettifyError(checkedWeek.error)}` };
  }
  const checkedTeams = z.array(TeamSchema).safeParse([...teams.values()].sort(compareTeams));
  if (!checkedTeams.success) {
    return { ok: false, error: `Teams verletzen Datenvertrag:\n${z.prettifyError(checkedTeams.error)}` };
  }
  return { ok: true, week: checkedWeek.data, teams: checkedTeams.data };
}

// Quoten (Sprint 2, D024). Getrennt von parseScoreboard, damit WeekFileSchema unverändert bleibt.

const EspnTeamOddsSchema = z.looseObject({ favorite: z.boolean().nullish() }).nullish();

const EspnOddsSchema = z.looseObject({
  provider: z.looseObject({ name: z.string().nullish() }).nullish(),
  details: z.string().nullish(),
  spread: z.number().nullish(),
  overUnder: z.number().nullish(),
  homeTeamOdds: EspnTeamOddsSchema,
  awayTeamOdds: EspnTeamOddsSchema,
});

const EspnOddsEventSchema = z.looseObject({
  id: z.string(),
  competitions: z
    .array(
      z.looseObject({
        competitors: z
          .array(
            z.looseObject({
              homeAway: z.string().nullish(),
              team: z.looseObject({ abbreviation: z.string().nullish() }).nullish(),
            }),
          )
          .nullish(),
        odds: z.unknown().optional(),
      }),
    )
    .nullish(),
});

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Normiert eine ESPN Quote auf den Spread aus Sicht des Heimteams.
 * Das Vorzeichen von spread ist bei ESPN nicht verlässlich, deshalb zählt nur der Betrag.
 * Die Richtung kommt aus dem favorite Flag, als Ersatz aus dem Kürzel im details Text.
 * Liefert null, wenn die Quote fehlt oder nicht eindeutig ist.
 */
export function normalizeOdds(
  rawOdds: unknown,
  homeAbbr: string | null,
  awayAbbr: string | null,
  fetchedAt: string,
): Odds | null {
  const parsed = EspnOddsSchema.safeParse(rawOdds);
  if (!parsed.success) return null;
  const o = parsed.data;
  const details = (o.details ?? "").trim();
  const detailsMatch = /^([A-Za-z]{2,4})\s*([+-]?\d+(?:\.\d+)?)$/.exec(details);

  let size: number | null = null;
  if (isFiniteNumber(o.spread)) size = Math.abs(o.spread);
  else if (detailsMatch) size = Math.abs(Number(detailsMatch[2]));

  const evenText = /^(even|pk|pick|pick'?em)$/i.test(details);
  let spreadHome: number | null = null;
  if (size === 0 || (evenText && (size === null || size === 0))) {
    spreadHome = 0;
  } else if (size !== null) {
    const homeFav = o.homeTeamOdds?.favorite === true;
    const awayFav = o.awayTeamOdds?.favorite === true;
    if (homeFav && !awayFav) spreadHome = -size;
    else if (awayFav && !homeFav) spreadHome = size;
    else if (detailsMatch) {
      const abbr = detailsMatch[1]!.toUpperCase();
      if (homeAbbr && abbr === homeAbbr.toUpperCase()) spreadHome = -size;
      else if (awayAbbr && abbr === awayAbbr.toUpperCase()) spreadHome = size;
    }
  }
  if (spreadHome === null) return null;

  const odds = {
    provider: o.provider?.name?.trim() || "unbekannt",
    // 0 statt -0, damit JSON und Vergleiche stabil sind
    spreadHome: spreadHome === 0 ? 0 : spreadHome,
    overUnder: isFiniteNumber(o.overUnder) && o.overUnder > 0 ? o.overUnder : null,
    fetchedAt,
  };
  const checked = OddsSchema.safeParse(odds);
  return checked.success ? checked.data : null;
}

/**
 * Liest die Quote jedes Spiels aus competitions[0].odds[0].
 * Wirft nie. Fehlende oder kaputte Quoten ergeben null für dieses Spiel, nicht einen Fehler für die Woche.
 */
export function parseOdds(raw: unknown, fetchedAt: string): Record<string, Odds | null> {
  const out: Record<string, Odds | null> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events)) return out;
  for (const rawEvent of events) {
    const ev = EspnOddsEventSchema.safeParse(rawEvent);
    if (!ev.success) continue;
    const comp = ev.data.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const abbr = (side: string) => competitors.find((c) => c.homeAway === side)?.team?.abbreviation ?? null;
    const first = Array.isArray(comp?.odds) ? (comp.odds as unknown[])[0] : undefined;
    out[ev.data.id] = normalizeOdds(first, abbr("home"), abbr("away"), fetchedAt);
  }
  return out;
}
