// Ranglisten Meldung per Issue Formular (D032). Reine Logik ohne Netz, Schreiber ist jobs/standings.ts.
// Ein Issue Formular schreibt pro Feld "### Label" und danach den Wert. Leere Felder heissen "_No response_".
import { z } from "zod";
import { StandingsFileSchema, type StandingsFile } from "./tips-schema";
import { REVIEW_SCHEMA_VERSION, StandingsHistorySchema, type StandingsHistory } from "./review-schema";

export const STANDINGS_LABEL = "rangliste";
export const OWNER_ASSOCIATION = "OWNER";
/** Kürzel der Gruppe, fest im Formular .github/ISSUE_TEMPLATE/rangliste.yml (D022, nur Kürzel). */
export const PLAYER_IDS = ["MS", "LM", "DH", "CZ", "JA"] as const;
/** Label im Formular je Feld id. Muss mit dem Template übereinstimmen. */
export const FIELD_LABELS = {
  season: "Saison",
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

export interface StandingsReport {
  season: number;
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
      const shown = raw === undefined || raw === "" || raw === NO_RESPONSE ? "leer" : `"${raw.slice(0, 20)}"`;
      errors.push(`${label}: keine gültige Zahl (${shown})`);
    }
    return n;
  };
  const season = need(FIELD_LABELS.season);
  const week = need(FIELD_LABELS.week);
  const players = PLAYER_IDS.map((id) => ({ id, points: need(FIELD_LABELS[id]) }));
  if (season !== null && (season < 2000 || season > 2100)) errors.push(`Saison ${season} ist unplausibel`);
  if (week !== null && (week < 1 || week > 23)) errors.push(`Woche ${week} muss zwischen 1 und 23 liegen`);
  if (errors.length > 0 || season === null || week === null) return { ok: false, errors };
  return { ok: true, report: { season, week, players: players.map((p) => ({ id: p.id, points: p.points! })) } };
}

export interface IssueEventInfo {
  authorAssociation: string | null;
  labels: string[];
  state: string | null;
  body: string;
  number: number | null;
}

const IssueEventSchema = z.looseObject({
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
  };
}

/** Nur Issues des Repo Owners mit Label rangliste werden übernommen. */
export function authorizedReport(info: IssueEventInfo): string | null {
  if (info.authorAssociation !== OWNER_ASSOCIATION) return `Autor ist nicht der Repo Owner (${info.authorAssociation ?? "unbekannt"})`;
  if (!info.labels.includes(STANDINGS_LABEL)) return `Label ${STANDINGS_LABEL} fehlt`;
  return null;
}

export type ApplyResult =
  | { ok: true; standings: StandingsFile; history: StandingsHistory }
  | { ok: false; errors: string[] };

/**
 * Prüft die Meldung gegen den letzten Stand und liefert die neuen Dateien.
 * In derselben Saison muss die Woche grösser sein als die letzte und kein Punktestand darf sinken.
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

  const sameSeason = history.entries.filter((e) => e.season === report.season);
  const later = history.entries.filter((e) => e.season > report.season);
  if (later.length > 0) errors.push(`Saison ${report.season} liegt vor der zuletzt gemeldeten Saison`);
  const last = sameSeason.reduce<(typeof sameSeason)[number] | null>((a, e) => (a === null || e.week > a.week ? e : a), null);
  if (last && report.week <= last.week) {
    errors.push(`Woche ${report.week} ist nicht grösser als die zuletzt gemeldete Week ${last.week}`);
  }
  if (last) {
    const before = new Map(last.players.map((p) => [p.id, p.points]));
    for (const p of report.players) {
      const b = before.get(p.id);
      if (b !== undefined && p.points < b) errors.push(`${p.id}: ${p.points} Punkte ist weniger als ${b} in Week ${last.week}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const players = [...report.players].sort((a, b) => b.points - a.points);
  const nextStandings = StandingsFileSchema.parse({
    schemaVersion: standings.schemaVersion,
    asOfWeek: report.week,
    updatedAt: now,
    me: standings.me,
    players,
  });
  const nextHistory = StandingsHistorySchema.parse({
    schemaVersion: REVIEW_SCHEMA_VERSION,
    entries: [...history.entries, { season: report.season, week: report.week, reportedAt: now, players }].sort(
      (a, b) => a.season - b.season || a.week - b.week,
    ),
  });
  return { ok: true, standings: nextStandings, history: nextHistory };
}

/** Wochenpunkte der Gruppe: Differenz zur Vorwoche derselben Saison, null ohne Vorwoche. */
export function weeklyPoints(history: StandingsHistory, season: number, week: number): Array<{ id: string; points: number | null }> | null {
  const entry = history.entries.find((e) => e.season === season && e.week === week);
  if (!entry) return null;
  const prev = history.entries
    .filter((e) => e.season === season && e.week < week)
    .reduce<(typeof history.entries)[number] | null>((a, e) => (a === null || e.week > a.week ? e : a), null);
  const before = new Map(prev?.players.map((p) => [p.id, p.points]) ?? []);
  return entry.players.map((p) => {
    const b = before.get(p.id);
    return { id: p.id, points: b === undefined ? null : p.points - b };
  });
}
