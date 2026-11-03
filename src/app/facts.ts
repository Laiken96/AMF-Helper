// Reine Formatierung für den Block Fakten im Spielbereich und im Spieldetail (D050).
// Markt, ESPN FPI, Tippverteilung ESPN Pick'em, Spielort und Signale für eine eigene Abweichung (D052).
// Nur Anzeige, der Vorschlag der App ändert sich dadurch nie (D009).
import { favoriteOf, type DeviationCandidate } from "../core/deviation";
import type { FpiGame } from "../core/fpi";
import type { InjuriesFile, KeyPlayer } from "../core/injuries";
import type { GamePicks } from "../core/picks";
import type { Game } from "../core/schema";
import type { GameTip } from "../core/tips-schema";
import { spreadText } from "./wording";

/** Echtes Minuszeichen für Spreads, liest sich besser als der Bindestrich. */
const MINUS = "−";

/** Ab dieser Differenz in Prozentpunkten weicht FPI deutlich vom Markt ab. */
export const FPI_GAP_PTS = 15;

/** Kurze Woche: weniger als 6 Ruhetage. */
export const SHORT_REST_DAYS = 6;

type Abbr = (teamId: string) => string;

/** Spread mit Vorzeichen, z. B. "−3", "+2.5" oder "0". */
export function signedSpread(n: number): string {
  if (n === 0) return "0";
  return n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`;
}

/** Spread für Screenreader, z. B. "minus 3" oder "plus 2.5". */
function spreadSpoken(n: number): string {
  if (n === 0) return "0";
  return n < 0 ? `minus ${Math.abs(n)}` : `plus ${n}`;
}

const pct = (p: number) => Math.round(p * 100);

/** Hat der Tipp ein getipptes Team mit Wahrscheinlichkeit? */
function pickOf(tip: Pick<GameTip, "pickTeamId" | "pickProb" | "level"> | null | undefined) {
  if (!tip || tip.pickTeamId === null || tip.level === "offen" || tip.level === "nicht_erfasst") return null;
  return { teamId: tip.pickTeamId, prob: tip.pickProb };
}

export interface MarketFact {
  /** "ATL 41 %", null ohne Tipp oder ohne Wahrscheinlichkeit. */
  prob: string | null;
  /** "Linie CIN −3" oder "Linie ausgeglichen" wie in der Tippliste, null ohne Quote. */
  line: string | null;
  /** "Start −9", nur wenn die erste erfasste Linie abweicht. */
  start: string | null;
  /** Ganze Zeile für Screenreader. */
  spoken: string;
}

/**
 * Markt: Siegwahrscheinlichkeit des getippten Teams und Linie aus Sicht des aktuellen Favoriten, bei
 * ausgeglichener Linie die Startlinie aus Sicht des Heimteams. Die erste Linie erscheint nur, wenn sie von der aktuellen abweicht. Null ohne Inhalt.
 */
export function marketFact(
  tip: Pick<GameTip, "pickTeamId" | "pickProb" | "level" | "odds" | "firstOdds"> | null | undefined,
  game: Pick<Game, "homeId" | "awayId">,
  abbr: Abbr,
): MarketFact | null {
  if (!tip) return null;
  const pick = pickOf(tip);
  const prob = pick && pick.prob !== null ? `${abbr(pick.teamId)} ${pct(pick.prob)} %` : null;
  const cur = tip.odds;
  let line: string | null = null;
  let start: string | null = null;
  const spoken: string[] = [];
  if (prob && pick && pick.prob !== null) spoken.push(`Siegwahrscheinlichkeit ${abbr(pick.teamId)} ${pct(pick.prob)} Prozent`);
  if (cur) {
    const b = cur.spreadHome;
    const homeView = b <= 0;
    const view = (s: number) => (homeView ? s : -s);
    const fav = abbr(homeView ? game.homeId : game.awayId);
    line = spreadText(cur, abbr(game.homeId), abbr(game.awayId));
    spoken.push(b === 0 ? "Linie ausgeglichen" : `Linie ${fav} ${spreadSpoken(view(b))}`);
    const first = tip.firstOdds;
    if (first && first.spreadHome !== b) {
      start = `Start ${signedSpread(view(first.spreadHome))}${b === 0 ? ` ${fav}` : ""}`;
      spoken.push(`zu Beginn ${spreadSpoken(view(first.spreadHome))}${b === 0 ? ` aus Sicht ${fav}` : ""}`);
    }
  }
  if (!prob && !line) return null;
  return { prob, line, start, spoken: spoken.join(", ") };
}

export interface FpiFact {
  abbr: string;
  /** Wahrscheinlichkeit in Prozent für das getippte Team (ohne Tipp das FPI Favoritenteam). */
  pct: number;
  /** Differenz zum Markt in Prozentpunkten (FPI minus Markt), null ohne Marktwert. */
  gap: number | null;
  /** Abweichung ab FPI_GAP_PTS Prozentpunkten. */
  large: boolean;
  /** "19 Punkte unter dem Markt", nur bei large. */
  gapText: string | null;
}

/** ESPN FPI für das getippte Team. Null ohne Eintrag oder wenn die Teams nicht zum Spiel passen. */
export function fpiFact(
  fpi: Pick<FpiGame, "homeId" | "awayId" | "pHome" | "pAway"> | null | undefined,
  game: Pick<Game, "homeId" | "awayId">,
  tip: Pick<GameTip, "pickTeamId" | "pickProb" | "level"> | null | undefined,
  abbr: Abbr,
): FpiFact | null {
  if (!fpi || fpi.homeId !== game.homeId || fpi.awayId !== game.awayId) return null;
  const pick = pickOf(tip);
  const teamId = pick ? pick.teamId : fpi.pHome >= fpi.pAway ? game.homeId : game.awayId;
  if (teamId !== game.homeId && teamId !== game.awayId) return null;
  const p = teamId === game.homeId ? fpi.pHome : fpi.pAway;
  const value = pct(p);
  const gap = pick && pick.prob !== null ? value - pct(pick.prob) : null;
  const large = gap !== null && Math.abs(gap) >= FPI_GAP_PTS;
  const gapText = large ? `${Math.abs(gap!)} Punkte ${gap! < 0 ? "unter" : "über"} dem Markt` : null;
  return { abbr: abbr(teamId), pct: value, gap, large, gapText };
}

export interface PicksFact {
  /** "88 % tippen CIN" */
  headline: string;
  awayPct: number;
  homePct: number;
  /** Getipptes Team liegt in der Minderheit: "Tipp ATL: 12 % tippen so". */
  pickNote: string | null;
  /** "90’653 Tipps bei ESPN" */
  sample: string;
}

const countFormat = new Intl.NumberFormat("de-CH");

/** Tippverteilung ESPN Pick'em. Mehrheit zuerst, Anteil des getippten Teams, wenn es in der Minderheit ist. */
export function picksFact(
  picks: Pick<GamePicks, "homeId" | "awayId" | "homeShare" | "awayShare" | "total"> | null | undefined,
  game: Pick<Game, "homeId" | "awayId">,
  tip: Pick<GameTip, "pickTeamId" | "pickProb" | "level"> | null | undefined,
  abbr: Abbr,
): PicksFact | null {
  if (!picks || picks.homeId !== game.homeId || picks.awayId !== game.awayId || picks.total < 1) return null;
  const homePct = pct(picks.homeShare);
  const awayPct = 100 - homePct;
  const homeMajor = picks.homeShare >= picks.awayShare;
  const majorId = homeMajor ? game.homeId : game.awayId;
  const pick = pickOf(tip);
  let pickNote: string | null = null;
  if (pick && pick.teamId !== majorId && (pick.teamId === game.homeId || pick.teamId === game.awayId)) {
    pickNote = `Tipp ${abbr(pick.teamId)}: ${pick.teamId === game.homeId ? homePct : awayPct} % tippen so`;
  }
  return {
    headline: `${homeMajor ? homePct : awayPct} % tippen ${abbr(majorId)}`,
    awayPct,
    homePct,
    pickNote,
    sample: `${countFormat.format(picks.total)} Tipps bei ESPN`,
  };
}

const COUNTRY_DE: Record<string, string> = {
  Spain: "Spanien",
  Germany: "Deutschland",
  Brazil: "Brasilien",
  Ireland: "Irland",
  Mexico: "Mexiko",
  Australia: "Australien",
  France: "Frankreich",
  Italy: "Italien",
  Canada: "Kanada",
  "United Kingdom": "England",
};

export interface VenueFact {
  /** "Santiago Bernabéu, Madrid, Spanien". Land nur ausserhalb der USA. */
  place: string | null;
  neutral: boolean;
  /** "CIN 7, ATL 7", null ohne Ruhetage. */
  rest: string | null;
  /** Teams mit kurzer Woche, z. B. "kurze Woche JAX, BAL". */
  short: string | null;
}

/** Spielort und Ruhetage aus der Wochendatei. Null, wenn nichts davon bekannt ist. */
export function venueFact(
  game: Pick<Game, "venue" | "venueInfo" | "neutralSite" | "homeRest" | "awayRest" | "homeId" | "awayId">,
  abbr: Abbr,
): VenueFact | null {
  const v = game.venueInfo;
  const country = v?.country && v.country !== "USA" ? (COUNTRY_DE[v.country] ?? v.country) : null;
  const parts = v ? [v.name ?? game.venue, v.city, country] : [game.venue];
  const place = parts.filter((x): x is string => Boolean(x)).join(", ") || null;
  const sides = [
    { id: game.awayId, rest: game.awayRest },
    { id: game.homeId, rest: game.homeRest },
  ].filter((s): s is { id: string; rest: number } => typeof s.rest === "number");
  const rest = sides.length > 0 ? sides.map((s) => `${abbr(s.id)} ${s.rest}`).join(", ") : null;
  const shortTeams = sides.filter((s) => s.rest < SHORT_REST_DAYS).map((s) => abbr(s.id));
  const short = shortTeams.length > 0 ? `kurze Woche ${shortTeams.join(", ")}` : null;
  if (!place && !rest && !game.neutralSite) return null;
  return { place, neutral: game.neutralSite, rest, short };
}

// ---------- Ausfälle (D030) ----------

const ROLE_WEIGHT: Record<KeyPlayer["roles"][number], number> = { passing: 4, rushing: 3, receiving: 3, qb: 1 };

/**
 * Wichtigster Ausfall des Spiels: Schlüsselspieler mit Out vor Doubtful, Leader vor reinem QB Eintrag.
 * Mit teamId nur Spieler dieses Teams.
 */
export function keyAbsence(injuries: InjuriesFile | null | undefined, gameId: string, teamId?: string): KeyPlayer | null {
  const game = injuries?.current.games.find((g) => g.gameId === gameId);
  if (!game) return null;
  let best: { p: KeyPlayer; score: number } | null = null;
  for (const p of game.players) {
    if (teamId !== undefined && p.teamId !== teamId) continue;
    const s = (p.status ?? "").trim().toLowerCase();
    const sev = s === "out" ? 2 : s === "doubtful" ? 1 : 0;
    if (sev === 0) continue;
    const role = Math.max(...p.roles.map((r) => ROLE_WEIGHT[r]));
    const score = sev * 10 + role;
    if (!best || score > best.score) best = { p, score };
  }
  return best?.p ?? null;
}

/** "CIN ohne Joe Burrow (QB, Out)" oder "CIN: Joe Burrow fraglich (QB, Doubtful)". */
export function absenceText(p: KeyPlayer): string {
  const detail = [p.pos, p.status].filter(Boolean).join(", ");
  return (p.status ?? "").toLowerCase() === "out"
    ? `${p.teamAbbr} ohne ${p.name} (${detail})`
    : `${p.teamAbbr}: ${p.name} fraglich (${detail})`;
}

// ---------- Signale für eine eigene Abweichung (D052) ----------

/** Ab dieser Bewegung in Punkten zählt die Linie als Bewegung Richtung Aussenseiter. */
export const SIGNAL_LINE_PTS = 1;
/** Ab so vielen Prozentpunkten sieht FPI den Aussenseiter deutlich stärker als der Markt. */
export const SIGNAL_FPI_PTS = 5;

export type SignalKind = "linie" | "fpi" | "ausfall";

export interface DeviationSignal {
  kind: SignalKind;
  /** Kurzer, vollständiger Text, nie nur Farbe. */
  text: string;
}

/**
 * Signale, die für den Aussenseiter sprechen: Linie bewegt sich zu ihm, ESPN FPI sieht ihn mindestens 5
 * Prozentpunkte stärker als der Markt, wichtiger Ausfall beim Favoriten. Leer ohne Quote.
 */
export function deviationSignals(input: {
  tip: Pick<GameTip, "pHome" | "odds" | "firstOdds">;
  game: Pick<Game, "id" | "homeId" | "awayId">;
  fpi?: Pick<FpiGame, "homeId" | "awayId" | "pHome" | "pAway"> | null;
  injuries?: InjuriesFile | null;
  abbr: Abbr;
}): DeviationSignal[] {
  const { tip, game, abbr } = input;
  const fav = favoriteOf(tip, game);
  if (!fav) return [];
  const dog = abbr(fav.underdogId);
  const out: DeviationSignal[] = [];

  const first = tip.firstOdds;
  const cur = tip.odds;
  if (first && cur) {
    const homeFav = fav.favoriteId === game.homeId;
    const view = (s: number) => (homeFav ? s : -s);
    if (view(cur.spreadHome) - view(first.spreadHome) >= SIGNAL_LINE_PTS) {
      out.push({
        kind: "linie",
        text: `Linie bewegt sich zu ${dog}: ${abbr(fav.favoriteId)} ${signedSpread(view(first.spreadHome))} > ${signedSpread(view(cur.spreadHome))}`,
      });
    }
  }

  const f = input.fpi;
  if (f && f.homeId === game.homeId && f.awayId === game.awayId) {
    const fpiDog = pct(fav.underdogId === game.homeId ? f.pHome : f.pAway);
    const marketDog = pct(1 - fav.favoriteProb);
    if (fpiDog - marketDog >= SIGNAL_FPI_PTS) {
      out.push({ kind: "fpi", text: `ESPN FPI sieht ${dog} bei ${fpiDog} %, der Markt bei ${marketDog} %` });
    }
  }

  const absent = keyAbsence(input.injuries, game.id, fav.favoriteId);
  if (absent) out.push({ kind: "ausfall", text: `Ausfall beim Favoriten: ${absenceText(absent)}` });
  return out;
}

/**
 * Hinweis zu einem Kandidaten, ein Satz. Beispiel: "Knappes Spiel, CIN 57 %. ATL tippen nur 28 % bei ESPN."
 * Ohne Tippverteilung: "Knappes Spiel, CIN 57 %, ohne Tippverteilung."
 */
export function candidateText(c: DeviationCandidate, abbr: Abbr): string {
  const base = `Knappes Spiel, ${abbr(c.favoriteId)} ${pct(c.favoriteProb)} %`;
  if (c.underdogShare === null) return `${base}, ohne Tippverteilung.`;
  return `${base}. ${abbr(c.underdogId)} tippen nur ${pct(c.underdogShare)} % bei ESPN.`;
}
