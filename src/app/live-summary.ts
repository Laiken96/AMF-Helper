// Liveticker (D054): reine Parser für die ESPN Summary eines laufenden Spiels und Hilfen für die Anzeige.
// Ohne React, damit Tests sie direkt gegen echte Antworten prüfen. Jedes Feld ist optional, fehlende oder
// unerwartete Werte ergeben leere Listen oder null, nie einen Fehler.

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
/** Pfad lesen: get(o, "a", "b") entspricht o?.a?.b. */
const get = (v: unknown, ...path: string[]): unknown => {
  let cur: unknown = v;
  for (const key of path) {
    const o = obj(cur);
    if (!o) return undefined;
    cur = o[key];
  }
  return cur;
};

export type Side = "home" | "away";

export interface SummaryTeam {
  id: string;
  side: Side;
  abbr: string | null;
  /** Bilanz gesamt, z. B. "5-2". */
  record: string | null;
  /** Punkte je Viertel, Index 0 ist Q1, ab Index 4 Verlängerung. */
  lines: (number | null)[];
}

export interface WinPoint {
  playId: string;
  /** Siegchance des Heimteams 0 bis 1. */
  home: number;
  /** Gespielte Zeit in Sekunden seit Kickoff, null wenn der Spielzug nicht zuzuordnen ist. */
  t: number | null;
}

export interface DriveInfo {
  teamId: string | null;
  plays: number | null;
  yards: number | null;
  time: string | null;
  start: string | null;
}

export interface SummaryPlay {
  id: string;
  text: string;
  type: string | null;
  period: number | null;
  clock: string | null;
  teamId: string | null;
  scoring: boolean;
}

export interface ScoringPlay {
  id: string;
  text: string;
  /** Kürzel wie TD oder FG. */
  type: string | null;
  period: number | null;
  clock: string | null;
  teamId: string | null;
  awayScore: number | null;
  homeScore: number | null;
}

export interface StatValue {
  display: string;
  /** Wert für die Balken, nie negativ. */
  value: number;
}

export interface StatRow {
  key: string;
  label: string;
  away: StatValue;
  home: StatValue;
}

export type LeaderCategory = "pass" | "rush" | "rec";

export interface Leader {
  category: LeaderCategory;
  teamId: string;
  name: string;
  display: string;
}

export interface GameInfo {
  venue: string | null;
  city: string | null;
  indoor: boolean | null;
  tempC: number | null;
  weather: string | null;
  tv: string[];
}

export interface LiveSummary {
  teams: SummaryTeam[];
  winProb: WinPoint[];
  drive: DriveInfo | null;
  /** Letzte Spielzüge, neueste zuerst. */
  plays: SummaryPlay[];
  /** Punktspielzüge in Spielfolge. */
  scoring: ScoringPlay[];
  stats: StatRow[];
  leaders: Leader[];
  info: GameInfo;
}

/** "4:23" in Sekunden. */
export function clockSeconds(clock: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(clock ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Gespielte Zeit seit Kickoff aus Viertel und Uhr. Viertel 15 Minuten, Verlängerung 10 Minuten. */
export function elapsedSeconds(period: number | null, clock: string | null): number | null {
  const s = clockSeconds(clock);
  if (period === null || period < 1 || s === null) return null;
  if (period <= 4) return (period - 1) * 900 + Math.max(0, 900 - s);
  return 3600 + (period - 5) * 600 + Math.max(0, 600 - s);
}

function parseTeams(raw: unknown): SummaryTeam[] {
  const comp = arr(get(raw, "header", "competitions"))[0];
  const out: SummaryTeam[] = [];
  for (const c of arr(get(comp, "competitors"))) {
    const id = str(get(c, "id")) ?? str(get(c, "team", "id"));
    const side = get(c, "homeAway");
    if (!id || (side !== "home" && side !== "away")) continue;
    const records = arr(get(c, "record"));
    const total = records.find((r) => get(r, "type") === "total") ?? records[0];
    out.push({
      id,
      side,
      abbr: str(get(c, "team", "abbreviation")),
      record: str(get(total, "summary")) ?? str(get(total, "displayValue")),
      lines: arr(get(c, "linescores")).map((l) => num(get(l, "displayValue")) ?? num(get(l, "value"))),
    });
  }
  return out;
}

/** Alle Spielzüge aus den Drives, ohne Doppel (der laufende Drive steht auch unter previous). */
function drivePlays(raw: unknown): { play: unknown; driveTeam: string | null }[] {
  const drives = [...arr(get(raw, "drives", "previous"))];
  const current = get(raw, "drives", "current");
  if (obj(current)) drives.push(current);
  const seen = new Set<string>();
  const out: { play: unknown; driveTeam: string | null }[] = [];
  for (const d of drives) {
    const driveTeam = str(get(d, "team", "id"));
    for (const p of arr(get(d, "plays"))) {
      const id = str(get(p, "id"));
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push({ play: p, driveTeam });
    }
  }
  return out;
}

function parsePlays(raw: unknown, limit: number): SummaryPlay[] {
  const plays: SummaryPlay[] = [];
  for (const { play: p, driveTeam } of drivePlays(raw)) {
    const text = str(get(p, "text"));
    if (!text) continue;
    plays.push({
      id: str(get(p, "id")) ?? `${plays.length}-${text}`,
      text,
      type: str(get(p, "type", "text")),
      period: num(get(p, "period", "number")),
      clock: str(get(p, "clock", "displayValue")),
      teamId: str(get(p, "start", "team", "id")) ?? driveTeam,
      scoring: get(p, "scoringPlay") === true,
    });
  }
  return plays.slice(-limit).reverse();
}

function parseWinProb(raw: unknown): WinPoint[] {
  const times = new Map<string, number>();
  for (const { play: p } of drivePlays(raw)) {
    const id = str(get(p, "id"));
    const t = elapsedSeconds(num(get(p, "period", "number")), str(get(p, "clock", "displayValue")));
    if (id && t !== null) times.set(id, t);
  }
  const out: WinPoint[] = [];
  for (const w of arr(get(raw, "winprobability"))) {
    const home = num(get(w, "homeWinPercentage"));
    if (home === null || home < 0 || home > 1) continue;
    const playId = str(get(w, "playId")) ?? String(out.length);
    out.push({ playId, home, t: times.get(playId) ?? null });
  }
  return out;
}

function parseDrive(raw: unknown): DriveInfo | null {
  const d = obj(get(raw, "drives", "current"));
  if (!d) return null;
  return {
    teamId: str(get(d, "team", "id")),
    plays: num(get(d, "offensivePlays")),
    yards: num(get(d, "yards")),
    time: str(get(d, "timeElapsed", "displayValue")),
    start: str(get(d, "start", "text")),
  };
}

function parseScoring(raw: unknown): ScoringPlay[] {
  const out: ScoringPlay[] = [];
  for (const p of arr(get(raw, "scoringPlays"))) {
    const text = str(get(p, "text"));
    if (!text) continue;
    out.push({
      id: str(get(p, "id")) ?? `${out.length}-${text}`,
      text,
      type: str(get(p, "type", "abbreviation")) ?? str(get(p, "type", "text")),
      period: num(get(p, "period", "number")),
      clock: str(get(p, "clock", "displayValue")),
      teamId: str(get(p, "team", "id")),
      awayScore: num(get(p, "awayScore")),
      homeScore: num(get(p, "homeScore")),
    });
  }
  return out;
}

/** Teamvergleich: Schlüssel aus boxscore.teams[].statistics, Bezeichnung auf Deutsch. */
const STAT_ROWS: { key: string; label: string; kind: "num" | "ratio" | "count" | "time" }[] = [
  { key: "totalYards", label: "Yards gesamt", kind: "num" },
  { key: "netPassingYards", label: "Pass Yards", kind: "num" },
  { key: "rushingYards", label: "Lauf Yards", kind: "num" },
  { key: "firstDowns", label: "First Downs", kind: "num" },
  { key: "thirdDownEff", label: "Third Down", kind: "ratio" },
  { key: "turnovers", label: "Ballverluste", kind: "num" },
  { key: "totalPenaltiesYards", label: "Strafen", kind: "count" },
  { key: "possessionTime", label: "Ballbesitz", kind: "time" },
];

function statValue(display: string, kind: (typeof STAT_ROWS)[number]["kind"]): StatValue | null {
  const d = display.trim();
  if (kind === "num") {
    const n = num(d);
    return n === null ? null : { display: d, value: Math.max(0, n) };
  }
  if (kind === "time") {
    const s = clockSeconds(d);
    return s === null ? null : { display: d, value: s };
  }
  const m = /^(\d+)\s*[-/]\s*(\d+)$/.exec(d);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (kind === "ratio") return { display: `${a} von ${b}`, value: b > 0 ? a / b : 0 };
  return { display: `${a} (${b} Yds)`, value: a };
}

function parseStats(raw: unknown): StatRow[] {
  const bySide = new Map<Side, Map<string, string>>();
  for (const t of arr(get(raw, "boxscore", "teams"))) {
    const side = get(t, "homeAway");
    if (side !== "home" && side !== "away") continue;
    const m = new Map<string, string>();
    for (const s of arr(get(t, "statistics"))) {
      const name = str(get(s, "name"));
      const value = typeof get(s, "displayValue") === "string" ? (get(s, "displayValue") as string) : null;
      if (name && value !== null && !m.has(name)) m.set(name, value);
    }
    bySide.set(side, m);
  }
  const away = bySide.get("away");
  const home = bySide.get("home");
  if (!away || !home) return [];
  const out: StatRow[] = [];
  for (const row of STAT_ROWS) {
    const a = away.get(row.key);
    const h = home.get(row.key);
    if (a === undefined || h === undefined) continue;
    const av = statValue(a, row.kind);
    const hv = statValue(h, row.kind);
    if (av && hv) out.push({ key: row.key, label: row.label, away: av, home: hv });
  }
  return out;
}

const LEADER_OF: Record<string, LeaderCategory> = {
  passingYards: "pass",
  rushingYards: "rush",
  receivingYards: "rec",
};

function parseLeaders(raw: unknown): Leader[] {
  const out: Leader[] = [];
  for (const t of arr(get(raw, "leaders"))) {
    const teamId = str(get(t, "team", "id"));
    if (!teamId) continue;
    for (const c of arr(get(t, "leaders"))) {
      const category = LEADER_OF[str(get(c, "name")) ?? ""];
      const top = arr(get(c, "leaders"))[0];
      const name = str(get(top, "athlete", "shortName")) ?? str(get(top, "athlete", "displayName"));
      const display = str(get(top, "displayValue"));
      if (category && name && display) out.push({ category, teamId, name, display });
    }
  }
  return out;
}

const WEATHER_DE: Record<string, string> = {
  sunny: "Sonnig",
  "mostly sunny": "Meist sonnig",
  "partly sunny": "Teils sonnig",
  clear: "Klar",
  "mostly clear": "Meist klar",
  "partly cloudy": "Teils bewölkt",
  "intermittent clouds": "Wechselnd bewölkt",
  "mostly cloudy": "Meist bewölkt",
  cloudy: "Bewölkt",
  overcast: "Bedeckt",
  fog: "Nebel",
  showers: "Schauer",
  rain: "Regen",
  "light rain": "Leichter Regen",
  thunderstorms: "Gewitter",
  snow: "Schnee",
  windy: "Windig",
};

/** Fahrenheit in Celsius, ganzzahlig gerundet. */
export const fahrenheitToCelsius = (f: number): number => Math.round(((f - 32) * 5) / 9);

function parseInfo(raw: unknown): GameInfo {
  const venue = get(raw, "gameInfo", "venue");
  const weather = get(raw, "gameInfo", "weather");
  const temp = num(get(weather, "temperature"));
  // conditionId ist teils ein Zahlencode (z. B. "38"), dann den Text aus displayValue nehmen oder weglassen
  const textOnly = (v: string | null | undefined) => (v && !/^\d+$/.test(v) ? v : null);
  const cond = textOnly(str(get(weather, "conditionId"))) ?? textOnly(str(get(weather, "displayValue")));
  const city = [str(get(venue, "address", "city")), str(get(venue, "address", "state"))].filter(Boolean).join(", ");
  const tv: string[] = [];
  const comp = arr(get(raw, "header", "competitions"))[0];
  for (const b of [...arr(get(comp, "broadcasts")), ...arr(get(raw, "broadcasts"))]) {
    const name = str(get(b, "media", "shortName")) ?? str(get(b, "media", "name"));
    if (name && !tv.includes(name)) tv.push(name);
  }
  const indoor = get(venue, "indoor");
  return {
    venue: str(get(venue, "fullName")),
    city: city || null,
    indoor: typeof indoor === "boolean" ? indoor : null,
    tempC: temp === null ? null : fahrenheitToCelsius(temp),
    weather: cond ? (WEATHER_DE[cond.toLowerCase()] ?? cond) : null,
    tv,
  };
}

/** Wandelt eine Summary Antwort in die Daten des Tickers. Wirft nur, wenn die Antwort kein Objekt ist. */
export function parseLiveSummary(raw: unknown, playLimit = 10): LiveSummary {
  if (!obj(raw)) throw new Error("Summary hat ein unerwartetes Format");
  return {
    teams: parseTeams(raw),
    winProb: parseWinProb(raw),
    drive: parseDrive(raw),
    plays: parsePlays(raw, playLimit),
    scoring: parseScoring(raw),
    stats: parseStats(raw),
    leaders: parseLeaders(raw),
    info: parseInfo(raw),
  };
}

// ---------- Hilfen für die Anzeige ----------

export interface FieldInput {
  /** Feldposition wie "SEA 31". */
  fieldText: string | null | undefined;
  /** Abstand zur Torlinie des Heimteams, 0 bis 100 (ESPN situation.yardLine). */
  yardLine: number | null | undefined;
  possessionTeamId: string | null | undefined;
  redZone?: boolean;
  home: { id: string; abbr: string };
  away: { id: string; abbr: string };
}

export interface FieldPosition {
  /** Ballposition von links, 0 ist die Endzone des Gastteams, 100 die des Heimteams. */
  x: number;
  /** Angriffsrichtung des Teams im Ballbesitz, null ohne Ballbesitz. */
  dir: "left" | "right" | null;
  /** Yards bis zur Endzone, die das Team im Ballbesitz angreift. */
  toGo: number | null;
  redZone: boolean;
  spoken: string;
}

/**
 * Ballposition für die Spielfeld Grafik. Links liegt die Endzone des Gastteams, rechts die des Heimteams,
 * das Heimteam greift also nach links an. Vorrang hat der Text "SEA 31", sonst ESPN yardLine.
 */
export function fieldPosition(input: FieldInput): FieldPosition | null {
  const { home, away } = input;
  let fromHome: number | null = null;
  let label: string | null = null;
  const text = input.fieldText?.trim() ?? "";
  const m = /^([A-Z]{2,4})\s+(\d{1,2})$/.exec(text);
  if (m && Number(m[2]) <= 50) {
    const n = Number(m[2]);
    if (m[1] === home.abbr) fromHome = n;
    else if (m[1] === away.abbr) fromHome = 100 - n;
    if (fromHome !== null) label = n === 50 ? "an der Mittellinie" : `bei ${m[1]} ${n}`;
  } else if (/^50$/.test(text)) {
    fromHome = 50;
    label = "an der Mittellinie";
  }
  if (fromHome === null && typeof input.yardLine === "number" && input.yardLine >= 0 && input.yardLine <= 100) {
    fromHome = input.yardLine;
    const own = fromHome <= 50;
    const n = own ? fromHome : 100 - fromHome;
    label = n === 50 ? "an der Mittellinie" : `bei ${own ? home.abbr : away.abbr} ${n}`;
  }
  if (fromHome === null || label === null) return null;
  const x = 100 - fromHome;
  const poss = input.possessionTeamId;
  const dir = poss === home.id ? "left" : poss === away.id ? "right" : null;
  const toGo = dir === "left" ? x : dir === "right" ? 100 - x : null;
  const redZone = input.redZone === true || (toGo !== null && toGo <= 20);
  const team = dir === "left" ? home.abbr : dir === "right" ? away.abbr : null;
  const spoken = team
    ? `Ball ${label}, ${team} greift an, noch ${toGo} Yards bis zur Endzone${redZone ? ", Red Zone" : ""}`
    : `Ball ${label}`;
  return { x, dir, toGo, redZone, spoken };
}

export type TipStanding = "vorne" | "hinten" | "gleich";

/** Liegt der Tipp nach Siegchance vorne? homeWin 0 bis 1. */
export function tipStanding(homeWin: number, pickTeamId: string, homeId: string): TipStanding {
  const pick = pickTeamId === homeId ? homeWin : 1 - homeWin;
  if (Math.abs(pick - 0.5) < 0.005) return "gleich";
  return pick > 0.5 ? "vorne" : "hinten";
}

/**
 * Punkte für die Linie der Siegchance: x 0 bis 1 über die Spielzeit (mindestens 60 Minuten), y Siegchance
 * des Heimteams. Spielzüge ohne Zeit erben die Zeit des vorherigen Punkts.
 */
export function winSeries(points: readonly WinPoint[]): { span: number; points: { x: number; y: number }[] } {
  if (points.length === 0) return { span: 3600, points: [] };
  let last = 0;
  const timed = points.map((p) => {
    const t = p.t === null ? last : Math.max(p.t, last);
    last = t;
    return { t, y: p.home };
  });
  const span = Math.max(3600, last);
  return { span, points: timed.map((p) => ({ x: p.t / span, y: p.y })) };
}
