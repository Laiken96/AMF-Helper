// Ausfall Wächter nach D030. ESPN Summary pro Spiel, Schlüsselspieler, Grundstand und Änderungen.
// Schreiber: jobs/watch.ts. Leser: jobs/push.ts und später die App.
// Eigene Datei data/injuries/<saison>-<typ>-<woche>.json mit eigener Version, WeekFileSchema bleibt unverändert.
import { z } from "zod";
import type { Game } from "./schema";

export const INJURIES_SCHEMA_VERSION = 1 as const;

export const ESPN_SUMMARY_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

export function summaryUrl(eventId: string): string {
  return `${ESPN_SUMMARY_BASE}?event=${encodeURIComponent(eventId)}`;
}

// Nur der relevante Teil des Summary. Alles andere bleibt durch looseObject erlaubt.
const EspnAthleteSchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  position: z.looseObject({ abbreviation: z.string() }).optional(),
});

const EspnTeamRefSchema = z.looseObject({
  id: z.string(),
  abbreviation: z.string(),
});

export const EspnSummarySchema = z.looseObject({
  injuries: z
    .array(
      z.looseObject({
        team: EspnTeamRefSchema,
        injuries: z
          .array(z.looseObject({ status: z.string(), athlete: EspnAthleteSchema }))
          .optional()
          .default([]),
      }),
    )
    .optional()
    .default([]),
  leaders: z
    .array(
      z.looseObject({
        team: EspnTeamRefSchema,
        leaders: z
          .array(
            z.looseObject({
              name: z.string(),
              leaders: z.array(z.looseObject({ athlete: EspnAthleteSchema })).optional().default([]),
            }),
          )
          .optional()
          .default([]),
      }),
    )
    .optional()
    .default([]),
});
export type EspnSummary = z.infer<typeof EspnSummarySchema>;

export const KeyRoleSchema = z.enum(["qb", "passing", "rushing", "receiving"]);
export type KeyRole = z.infer<typeof KeyRoleSchema>;

/** Leader Kategorien aus dem Summary, die als Schlüsselspieler zählen (D030). */
export const LEADER_ROLES: Record<string, KeyRole> = {
  passingYards: "passing",
  rushingYards: "rushing",
  receivingYards: "receiving",
};

export const KeyPlayerSchema = z.object({
  athleteId: z.string(),
  name: z.string(), // displayName aus ESPN
  pos: z.string().nullable(), // z. B. "QB"
  teamId: z.string(),
  teamAbbr: z.string(),
  roles: z.array(KeyRoleSchema).min(1),
  status: z.string().nullable(), // Status aus der Verletztenliste, null ohne Eintrag
});
export type KeyPlayer = z.infer<typeof KeyPlayerSchema>;

export const GameKeyPlayersSchema = z.object({
  gameId: z.string(),
  kickoffUtc: z.string().datetime(),
  players: z.array(KeyPlayerSchema),
});
export type GameKeyPlayers = z.infer<typeof GameKeyPlayersSchema>;

export const InjuryStateSchema = z.object({
  takenAt: z.string().datetime(),
  games: z.array(GameKeyPlayersSchema),
});
export type InjuryState = z.infer<typeof InjuryStateSchema>;

export const ChangeKindSchema = z.enum(["neu", "wechsel", "weg"]);
// neu: Spieler hat seit dem Grundstand einen Eintrag bekommen
// wechsel: Status hat sich geändert, z. B. Questionable zu Out
// weg: Eintrag ist verschwunden, der Spieler gilt wieder als fit

export const InjuryChangeSchema = z.object({
  gameId: z.string(),
  athleteId: z.string(),
  name: z.string(),
  pos: z.string().nullable(),
  teamAbbr: z.string(),
  kind: ChangeKindSchema,
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type InjuryChange = z.infer<typeof InjuryChangeSchema>;

export const InjuriesFileSchema = z.object({
  schemaVersion: z.literal(INJURIES_SCHEMA_VERSION),
  season: z.number().int(),
  seasonType: z.number().int(),
  week: z.number().int(),
  baselineFrom: z.string().datetime(), // Donnerstag 00:00 America/New_York der Woche
  baseline: InjuryStateSchema.nullable(), // null vor dem Donnerstag, danach nie überschrieben
  current: InjuryStateSchema,
  changes: z.array(InjuryChangeSchema), // leer ohne Grundstand
});
export type InjuriesFile = z.infer<typeof InjuriesFileSchema>;

export function injuriesFilePath(season: number, seasonType: number, week: number): string {
  return `injuries/${season}-${seasonType}-${String(week).padStart(2, "0")}.json`;
}

export type SummaryParse = { ok: true; summary: EspnSummary } | { ok: false; error: string };

export function parseSummary(raw: unknown): SummaryParse {
  const r = EspnSummarySchema.safeParse(raw);
  return r.success ? { ok: true, summary: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

/**
 * Schlüsselspieler eines Spiels nach D030: alle Quarterbacks aus der Verletztenliste und je Team
 * der erste Passing, Rushing und Receiving Leader. Status kommt nur aus der Verletztenliste.
 * Sortiert nach Team und Athlet ID, damit Vergleiche stabil sind.
 */
export function keyPlayersFromSummary(summary: EspnSummary): KeyPlayer[] {
  const status = new Map<string, string>();
  const players = new Map<string, KeyPlayer>();
  const add = (team: { id: string; abbreviation: string }, a: z.infer<typeof EspnAthleteSchema>, role: KeyRole) => {
    const key = `${team.id}:${a.id}`;
    const existing = players.get(key);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    players.set(key, {
      athleteId: a.id,
      name: a.displayName,
      pos: a.position?.abbreviation ?? null,
      teamId: team.id,
      teamAbbr: team.abbreviation,
      roles: [role],
      status: null,
    });
  };
  for (const t of summary.injuries) {
    for (const inj of t.injuries) {
      status.set(`${t.team.id}:${inj.athlete.id}`, inj.status);
      if (inj.athlete.position?.abbreviation === "QB") add(t.team, inj.athlete, "qb");
    }
  }
  for (const t of summary.leaders) {
    for (const cat of t.leaders) {
      const role = LEADER_ROLES[cat.name];
      const first = cat.leaders[0];
      if (role && first) {
        add(t.team, first.athlete, role);
        if (first.athlete.position?.abbreviation === "QB") add(t.team, first.athlete, "qb");
      }
    }
  }
  const order = KeyRoleSchema.options;
  return [...players.entries()]
    .map(([key, p]) => ({
      ...p,
      roles: [...p.roles].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
      status: status.get(key) ?? null,
    }))
    .sort((a, b) => a.teamAbbr.localeCompare(b.teamAbbr) || a.athleteId.localeCompare(b.athleteId, "en", { numeric: true }));
}

// Zeitlogik America/New_York ohne Bibliothek.
const NY_TZ = "America/New_York";
const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyParts(ms: number): { weekday: string; y: number; m: number; d: number; hour: number; minute: number } {
  const map: Record<string, string> = {};
  for (const p of nyFormatter.formatToParts(new Date(ms))) map[p.type] = p.value;
  return {
    weekday: map.weekday ?? "",
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
  };
}

/** 00:00 America/New_York eines Kalendertags als UTC Millisekunden. Prüft beide möglichen Offsets. */
export function nyMidnightUtc(y: number, m: number, d: number): number {
  for (const offsetHours of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, offsetHours);
    const p = nyParts(ms);
    if (p.y === y && p.m === m && p.d === d && p.hour === 0 && p.minute === 0) return ms;
  }
  throw new RangeError(`Mitternacht in New York nicht bestimmbar: ${y}-${m}-${d}`);
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Beginn des Grundstands einer Woche: Donnerstag 00:00 America/New_York vor dem ersten Sonntag
 * ab dem frühesten Kickoff. Liegt ein Spiel noch früher (z. B. Mittwoch), gilt dessen Tag 00:00.
 */
export function baselineStartUtc(games: ReadonlyArray<Pick<Game, "kickoffUtc">>): string {
  if (games.length === 0) throw new RangeError("Woche ohne Spiele, kein Grundstand bestimmbar");
  const earliest = Math.min(...games.map((g) => Date.parse(g.kickoffUtc)));
  const p = nyParts(earliest);
  const dow = WEEKDAY_INDEX[p.weekday] ?? 0;
  const toSunday = (7 - dow) % 7;
  // Kalenderrechnung über UTC Datum, unabhängig von Sommerzeit.
  const sunday = new Date(Date.UTC(p.y, p.m - 1, p.d + toSunday));
  const thursday = new Date(Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate() - 3));
  const thuMs = nyMidnightUtc(thursday.getUTCFullYear(), thursday.getUTCMonth() + 1, thursday.getUTCDate());
  const dayMs = nyMidnightUtc(p.y, p.m, p.d);
  return new Date(Math.min(thuMs, dayMs)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Änderungen zwischen Grundstand und aktuellem Stand pro Spiel. Betrachtet werden alle Spieler,
 * die in einem der beiden Stände Schlüsselspieler sind. Spiele ohne Grundstand fallen weg.
 */
export function diffInjuries(baseline: InjuryState | null, current: InjuryState): InjuryChange[] {
  if (!baseline) return [];
  const out: InjuryChange[] = [];
  const baseGames = new Map(baseline.games.map((g) => [g.gameId, g]));
  for (const cur of current.games) {
    const base = baseGames.get(cur.gameId);
    if (!base) continue;
    const before = new Map(base.players.map((p) => [`${p.teamId}:${p.athleteId}`, p]));
    const after = new Map(cur.players.map((p) => [`${p.teamId}:${p.athleteId}`, p]));
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    for (const key of keys) {
      const a = before.get(key);
      const b = after.get(key);
      const from = a?.status ?? null;
      const to = b?.status ?? null;
      if (from === to) continue;
      const ref = (b ?? a)!;
      out.push({
        gameId: cur.gameId,
        athleteId: ref.athleteId,
        name: ref.name,
        pos: ref.pos,
        teamAbbr: ref.teamAbbr,
        kind: from === null ? "neu" : to === null ? "weg" : "wechsel",
        from,
        to,
      });
    }
  }
  return out;
}

export interface BuildInjuriesInput {
  season: number;
  seasonType: number;
  week: number;
  games: ReadonlyArray<Pick<Game, "id" | "kickoffUtc">>;
  /** Frisch geladene Schlüsselspieler je Spiel ID. Fehlende Spiele übernehmen den bisherigen Stand. */
  fetched: ReadonlyMap<string, KeyPlayer[]>;
  /** true, wenn alle benötigten Spiele erfolgreich geladen wurden. Nur dann wird ein Grundstand gesetzt. */
  complete: boolean;
  existing: InjuriesFile | null;
  now: string;
}

/** Baut die Ausfall Datei. Der Grundstand wird einmal gesetzt, sobald now ab baselineFrom liegt. */
export function buildInjuriesFile(input: BuildInjuriesInput): InjuriesFile {
  const { existing, now } = input;
  const prev = new Map((existing?.current.games ?? []).map((g) => [g.gameId, g]));
  const games: GameKeyPlayers[] = [];
  for (const g of [...input.games].sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.id.localeCompare(b.id))) {
    const fresh = input.fetched.get(g.id);
    if (fresh) games.push({ gameId: g.id, kickoffUtc: g.kickoffUtc, players: fresh });
    else {
      const old = prev.get(g.id);
      if (old) games.push({ ...old, kickoffUtc: g.kickoffUtc });
    }
  }
  const current: InjuryState = { takenAt: now, games };
  const baselineFrom = baselineStartUtc(input.games);
  let baseline = existing?.baseline ?? null;
  if (!baseline && input.complete && Date.parse(now) >= Date.parse(baselineFrom)) baseline = current;
  return InjuriesFileSchema.parse({
    schemaVersion: INJURIES_SCHEMA_VERSION,
    season: input.season,
    seasonType: input.seasonType,
    week: input.week,
    baselineFrom,
    baseline,
    current,
    changes: diffInjuries(baseline, current),
  });
}

/** Vergleicht zwei Dateien ohne den Zeitstempel des aktuellen Stands, damit Commits nur echte Änderungen zeigen. */
export function sameInjuriesContent(a: InjuriesFile, b: InjuriesFile): boolean {
  const strip = (f: InjuriesFile) => JSON.stringify({ ...f, current: { ...f.current, takenAt: "" } });
  return strip(a) === strip(b);
}
