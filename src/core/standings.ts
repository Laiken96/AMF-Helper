// Ranglisten Meldung per Issue Formular (D032). Reine Logik ohne Netz, Schreiber ist jobs/standings.ts.
// Ein Issue Formular schreibt pro Feld "### Label" und danach den Wert. Leere Felder heissen "_No response_".
import { z } from "zod";
import { StandingsFileSchema as StandingsFileV1Schema } from "./tips-schema";
import { STANDINGS_HISTORY_SCHEMA_VERSION, StandingsHistorySchema, type StandingsHistory } from "./review-schema";
import { previousTipWeek, weekOrder } from "./season-calendar";

/**
 * Version von data/standings.json. 2 ergänzt season (Saison der Rangliste). Das Schema liest Version 1 weiter,
 * dort fehlt season. Das Basisschema liegt in tips-schema.ts und muss dieselben Versionen akzeptieren.
 */
export const STANDINGS_SCHEMA_VERSION = 2 as const;
export const StandingsFileSchema = StandingsFileV1Schema.extend({
  schemaVersion: z.union([z.literal(1), z.literal(STANDINGS_SCHEMA_VERSION)]),
  season: z.number().int().optional(), // fehlt in Version 1
});
export type StandingsFile = z.infer<typeof StandingsFileSchema>;

/**
 * Gilt die Rangliste für diese Saison? Ohne season (Version 1, Stand 2026) gilt sie. Aus einer anderen Saison
 * gilt sie nicht, dann ist der Rückstand für die Abweichungen 0, bis die erste Meldung der neuen Saison kommt.
 */
export function standingsAppliesTo(standings: { season?: number }, season: number): boolean {
  return standings.season === undefined || standings.season === season;
}

export const STANDINGS_LABEL = "rangliste";
export const OWNER_ASSOCIATION = "OWNER";
/** Kürzel der Gruppe, fest im Formular .github/ISSUE_TEMPLATE/rangliste.yml (D022, nur Kürzel). */
export const PLAYER_IDS = ["MS", "LM", "DH", "CZ", "JA"] as const;
/** Label im Formular je Feld id. Muss mit dem Template übereinstimmen. */
export const FIELD_LABELS = {
  season: "Saison",
  seasonType: "Saisontyp",
  week: "Woche",
  MS: "MS",
  LM: "LM",
  DH: "DH",
  CZ: "CZ",
  JA: "JA",
} as const;
export const NO_RESPONSE = "_No response_";

/** Zerlegt den Body eines Issue Formulars in Label und Wert. Spätere Abschnitte mit gleichem Label gewinnen nicht. */
export function parseFormSections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = body.replace(/\r\n?/g, "\n");
  const parts = text.split(/^###[ \t]+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = (nl < 0 ? part : part.slice(0, nl)).trim();
    const value = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    if (label && !out.has(label)) out.set(label, value);
  }
  return out;
}

/** Ganze Zahl ab 0. Erlaubt Leerzeichen und Tausendertrennzeichen (Apostroph, Punkt, Komma, schmales Leerzeichen). */
export function parseCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === "" || v === NO_RESPONSE) return null;
  if (!/^\d{1,3}([ '’.,  ]?\d{3})*$|^\d+$/.test(v)) return null;
  const n = Number(v.replace(/\D/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

/** Dropdown Wert "Regular (2)" oder "Postseason (3)". Leer gilt als Regular Season, wie im Formular vorbelegt. */
export function parseSeasonType(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (v === "" || v === NO_RESPONSE) return 2;
  const digit = /\((\d)\)\s*$/.exec(v)?.[1] ?? (/^\d$/.test(v) ? v : null);
  const word = /^regular/i.test(v) ? "2" : /^postseason/i.test(v) ? "3" : null;
  if (digit !== null && word !== null && digit !== word) return null;
  const t = digit ?? word;
  if (t === "2") return 2;
  if (t === "3") return 3;
  return null;
}

/** Obergrenze für Gesamtpunkte, mehr Spiele als 300 hat keine Saison bis zur letzten Woche. */
export const MAX_POINTS = 300;
export const RAW_MAX = 40;

/** Rohwert für den Kommentar: eine Zeile, ohne Backticks, höchstens 40 Zeichen. */
export function shortRaw(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/`/g, "").replace(/\s+/g, " ").trim().slice(0, RAW_MAX);
}

export interface StandingsReport {
  season: number;
  seasonType: number;
  week: number;
  players: Array<{ id: string; points: number }>;
}

export type ParseReportResult = { ok: true; report: StandingsReport } | { ok: false; errors: string[] };

/** Liest Saison, Woche und die fünf Punktestände aus dem Body. Sammelt alle Fehler. */
export function parseReportBody(body: string): ParseReportResult {
  const sections = parseFormSections(body);
  const errors: string[] = [];
  const need = (label: string): number | null => {
    const raw = sections.get(label);
    const n = parseCount(raw);
    if (n === null) {
      const shown = raw === undefined || raw === "" || raw === NO_RESPONSE ? "leer" : `"${shortRaw(raw)}"`;
      errors.push(`${label}: keine gültige Zahl (${shown})`);
    }
    return n;
  };
  const season = need(FIELD_LABELS.season);
  const seasonType = parseSeasonType(sections.get(FIELD_LABELS.seasonType));
  if (seasonType === null) errors.push(`${FIELD_LABELS.seasonType}: nur Regular (2) oder Postseason (3)`);
  const week = need(FIELD_LABELS.week);
  const players = PLAYER_IDS.map((id) => ({ id, points: need(FIELD_LABELS[id]) }));
  for (const p of players) {
    if (p.points !== null && p.points > MAX_POINTS) errors.push(`${p.id}: ${p.points} Punkte ist mehr als ${MAX_POINTS}, Tippfehler?`);
  }
  if (season !== null && (season < 2000 || season > 2100)) errors.push(`Saison ${season} ist unplausibel`);
  if (week !== null && (week < 1 || week > 23)) errors.push(`Woche ${week} muss zwischen 1 und 23 liegen`);
  if (errors.length > 0 || season === null || week === null || seasonType === null) return { ok: false, errors };
  return { ok: true, report: { season, seasonType, week, players: players.map((p) => ({ id: p.id, points: p.points! })) } };
}

export interface IssueEventInfo {
  authorAssociation: string | null;
  labels: string[];
  state: string | null;
  body: string;
  number: number | null;
  senderLogin: string | null;
  ownerLogin: string | null;
}

const IssueEventSchema = z.looseObject({
  sender: z.looseObject({ login: z.string().optional() }).optional(),
  repository: z.looseObject({ owner: z.looseObject({ login: z.string().optional() }).optional() }).optional(),
  issue: z.looseObject({
    number: z.number().int().optional(),
    state: z.string().optional(),
    body: z.string().nullable().optional(),
    author_association: z.string().optional(),
    labels: z.array(z.union([z.string(), z.looseObject({ name: z.string().optional() })])).optional(),
  }),
});

/** Liest die relevanten Felder aus der Event Datei von GitHub Actions. */
export function issueInfo(event: unknown): IssueEventInfo | null {
  const parsed = IssueEventSchema.safeParse(event);
  if (!parsed.success) return null;
  const i = parsed.data.issue;
  return {
    authorAssociation: i.author_association ?? null,
    labels: (i.labels ?? []).flatMap((l) => (typeof l === "string" ? [l] : l.name ? [l.name] : [])),
    state: i.state ?? null,
    body: i.body ?? "",
    number: i.number ?? null,
    senderLogin: parsed.data.sender?.login ?? null,
    ownerLogin: parsed.data.repository?.owner?.login ?? null,
  };
}

/** Nur Issues des Repo Owners mit Label rangliste werden übernommen. */
export function authorizedReport(info: IssueEventInfo): string | null {
  if (info.authorAssociation !== OWNER_ASSOCIATION) return `Autor ist nicht der Repo Owner (${info.authorAssociation ?? "unbekannt"})`;
  if (info.senderLogin === null || info.senderLogin !== info.ownerLogin) {
    return `Auslöser ${info.senderLogin ?? "unbekannt"} ist nicht der Repo Owner`;
  }
  if (!info.labels.includes(STANDINGS_LABEL)) return `Label ${STANDINGS_LABEL} fehlt`;
  return null;
}

export type ApplyResult =
  | { ok: true; unchanged: boolean; replaced: boolean; standings: StandingsFile; history: StandingsHistory }
  | { ok: false; errors: string[] };

type Entry = StandingsHistory["entries"][number];

const order = weekOrder;
const weekName = (e: { seasonType: number; week: number }) => `${e.seasonType === 3 ? "Postseason " : ""}Week ${e.week}`;

function samePlayers(a: Entry["players"], b: Entry["players"]): boolean {
  const key = (ps: Entry["players"]) => JSON.stringify([...ps].sort((x, y) => x.id.localeCompare(y.id)));
  return key(a) === key(b);
}

/**
 * Prüft die Meldung gegen den letzten Stand und liefert die neuen Dateien.
 * Neue Woche: grösser als die letzte, kein Punktestand sinkt gegenüber der letzten.
 * Gleiche Woche wie die letzte: ersetzt sie als Korrektur, geprüft gegen den Eintrag davor.
 * Frühere Woche: abgelehnt. Identische Meldung: Erfolg ohne Änderung.
 */
export function applyReport(
  report: StandingsReport,
  standings: StandingsFile,
  history: StandingsHistory,
  now: string,
): ApplyResult {
  const errors: string[] = [];
  const known = new Set(standings.players.map((p) => p.id));
  for (const id of PLAYER_IDS) if (!known.has(id)) errors.push(`Kürzel ${id} fehlt in data/standings.json`);
  for (const id of known) if (!(PLAYER_IDS as readonly string[]).includes(id)) errors.push(`Kürzel ${id} fehlt im Formular`);

  if (history.entries.some((e) => e.season > report.season)) {
    errors.push(`Saison ${report.season} liegt vor der zuletzt gemeldeten Saison`);
  }
  const sameSeason = history.entries.filter((e) => e.season === report.season).sort((a, b) => order(a) - order(b));
  const last = sameSeason.at(-1) ?? null;
  const replaced = last !== null && order(last) === order(report);
  if (last && replaced && samePlayers(last.players, report.players) && errors.length === 0) {
    return { ok: true, unchanged: true, replaced: false, standings, history };
  }
  if (last && order(report) < order(last)) {
    errors.push(
      `${weekName(report)} liegt vor der zuletzt gemeldeten ${weekName(last)}. ` +
        `Korrekturen gehen nur für die letzte Woche: ${weekName(last)} nochmals mit allen Werten melden`,
    );
  }
  const base = replaced ? (sameSeason.at(-2) ?? null) : last;
  if (base && errors.length === 0) {
    const before = new Map(base.players.map((p) => [p.id, p.points]));
    for (const p of report.players) {
      const b = before.get(p.id);
      if (b !== undefined && p.points < b) {
        errors.push(
          `${p.id}: ${p.points} Punkte ist weniger als ${b} in ${weekName(base)}. ` +
            `Ist ${weekName(base)} falsch, zuerst ${weekName(base)} nochmals korrekt melden`,
        );
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const players = [...report.players].sort((a, b) => b.points - a.points);
  const entry: Entry = { season: report.season, seasonType: report.seasonType, week: report.week, reportedAt: now, players };
  const kept = history.entries.filter((e) => !(e.season === report.season && order(e) === order(report)));
  const nextStandings = StandingsFileSchema.parse({
    schemaVersion: STANDINGS_SCHEMA_VERSION,
    season: report.season,
    asOfWeek: report.week,
    updatedAt: now,
    me: standings.me,
    players,
  });
  const nextHistory = StandingsHistorySchema.parse({
    schemaVersion: STANDINGS_HISTORY_SCHEMA_VERSION,
    entries: [...kept, entry].sort((a, b) => a.season - b.season || order(a) - order(b)),
  });
  return { ok: true, unchanged: false, replaced, standings: nextStandings, history: nextHistory };
}

export interface GroupWeekRow {
  id: string;
  total: number;
  week: number | null; // Wochenpunkte, null wenn die Vorwoche nicht gemeldet ist
}

/**
 * Eintrag, gegen den die Wochenpunkte einer Woche gerechnet werden: der letzte Eintrag derselben Saison mit
 * kleinerer Ordnung (seasonType mal 100 plus Woche), also auch Regular Week 18 vor Postseason Week 1.
 * Er zählt nur, wenn keine Tippwoche dazwischen fehlt, sonst wären es Punkte mehrerer Wochen.
 * "start" bei Regular Week 1 ohne früheren Eintrag (Start bei 0), null ohne passende Vorwoche.
 */
export function baseEntry(history: StandingsHistory, season: number, seasonType: number, week: number): Entry | "start" | null {
  const target = { season, seasonType, week };
  const prev = history.entries
    .filter((e) => e.season === season && order(e) < order(target))
    .sort((a, b) => order(a) - order(b))
    .at(-1);
  const expected = previousTipWeek(target);
  if (expected === null) return seasonType === 2 && week === 1 ? "start" : null;
  if (!prev || order(prev) < order(expected)) return null;
  return prev;
}

/**
 * Wochenpunkte der Gruppe: Stand der Woche minus Stand der Vorwoche nach baseEntry.
 * Week 1 der Regular Season zählt ab 0. Ohne Vorwoche null. Ohne Eintrag der Woche null.
 */
export function groupWeekRows(history: StandingsHistory, season: number, seasonType: number, week: number): GroupWeekRow[] | null {
  const entry = history.entries.find((e) => e.season === season && e.seasonType === seasonType && e.week === week);
  if (!entry) return null;
  const base = baseEntry(history, season, seasonType, week);
  return entry.players.map((p) => {
    const before = base === "start" ? 0 : base?.players.find((q) => q.id === p.id)?.points;
    return { id: p.id, total: p.points, week: before === undefined ? null : p.points - before };
  });
}

/** Gemeldete Wochenpunkte eines Kürzels, null wenn Woche oder Vorwoche fehlt oder das Kürzel nicht vorkommt. */
export function reportedWeekPoints(
  history: StandingsHistory,
  season: number,
  seasonType: number,
  week: number,
  playerId: string,
): number | null {
  return groupWeekRows(history, season, seasonType, week)?.find((r) => r.id === playerId)?.week ?? null;
}
