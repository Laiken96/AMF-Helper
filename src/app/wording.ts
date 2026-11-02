// Einheitliche Texte der Oberfläche (D050): Datenstand, Spielstatus, Countdown, Tiebreaker, Abweichung.
// Reine Funktionen ohne React, damit sie direkt testbar sind.
import type { Odds } from "../core/tips-schema";
import { formatKickoffZurich } from "../core/time";

/** Datenstand überall gleich: "Stand Mo 02.11. 22:47" in Schweizer Zeit. */
export function formatStand(iso: string): string {
  try {
    return `Stand ${formatKickoffZurich(iso)}`;
  } catch {
    return "Stand unbekannt";
  }
}

/** Hinweis zur Zeitzone, einmal im Kopf der Tipps und in den Einstellungen. */
export const TIME_ZONE_TEXT = "Zeiten in Schweizer Zeit";

/**
 * ESPN Statustexte auf Deutsch. "Final" wird "Beendet", "Final/OT" wird "Beendet n. V.",
 * mehrfache Verlängerung ("Final/2OT") ebenso. Andere Texte bleiben, Halbzeit und Verschiebung übersetzt.
 */
export function statusWord(detail: string | null | undefined): string {
  const d = (detail ?? "").trim();
  if (d === "") return "";
  if (/^final$/i.test(d)) return "Beendet";
  if (/^final\s*\/\s*\d*\s*OT$/i.test(d)) return "Beendet n. V.";
  if (/^halftime$/i.test(d)) return "Halbzeit";
  if (/^postponed$/i.test(d)) return "Verschoben";
  if (/^canceled$|^cancelled$/i.test(d)) return "Abgesagt";
  if (/^delayed$/i.test(d)) return "Verzögert";
  if (/^end of (\d)(st|nd|rd|th) quarter$/i.test(d)) return `Ende Q${/(\d)/.exec(d)![1]}`;
  return d;
}

export type SlotName = "thursday" | "monday";

/** Tiebreaker und Spielbereich: immer TNF und MNF, nie Wochentag oder "Monday Night". */
export const SLOT_SHORT: Record<SlotName, string> = { thursday: "TNF", monday: "MNF" };
export const SLOT_LONG: Record<SlotName, string> = { thursday: "Thursday Night Football", monday: "Monday Night Football" };

/** "3 Tg 21 h", "5 h 12 min" oder "12 min". Minuten aufgerundet, nie weniger als die echte Restzeit. */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} Tg ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Countdown immer mit "Tippschluss in". */
export const tippschlussText = (ms: number): string => `Tippschluss in ${formatCountdown(ms)}`;

/** Resultat immer mit Leerzeichen um den Doppelpunkt, "22 : 25". */
export const scoreText = (away: number, home: number): string => `${away} : ${home}`;
/** Vorleser: "Tipp 22 zu 25". */
export const scoreAria = (away: number, home: number, prefix = "Tipp"): string => `${prefix} ${away} zu ${home}`;

/**
 * Linie aus Sicht des Favoriten, z. B. "Linie ATL −3". spreadHome negativ heisst Heimteam favorisiert.
 * Ohne Quote null.
 */
export function spreadText(odds: Odds | null, homeAbbr: string, awayAbbr: string): string | null {
  if (!odds) return null;
  const s = odds.spreadHome;
  if (s === 0) return "Linie ausgeglichen";
  const fav = s < 0 ? homeAbbr : awayAbbr;
  const size = Math.abs(s);
  return `Linie ${fav} −${Number.isInteger(size) ? size : size.toFixed(1)}`;
}

export interface DeviationInput {
  pickAbbr: string;
  pickProb: number | null;
  /** Grundtipp (firstPickTeamId) mit seiner Wahrscheinlichkeit. */
  baseAbbr: string | null;
  baseProb: number | null;
  spread: string | null;
  maxDeviations: number;
  /** Rückstand auf Platz 1 in Punkten, 0 bei Führung, null ohne Rangliste. */
  gap: number | null;
}

const pctOf = (p: number | null) => (p === null ? null : `${Math.round(p * 100)} %`);

/**
 * Begründung einer Abweichung in zwei Sätzen: was der Grundtipp war und warum bewusst abgewichen wird.
 * Beispiel: "Grundtipp ATL 59 %, Linie ATL −3. Bewusster Aussenseitertipp CIN 41 %, erlaubt sind diese
 * Woche 2 Abweichungen wegen 26 Punkten Rückstand auf Platz 1."
 */
export function deviationReason(i: DeviationInput): string {
  const base =
    i.baseAbbr && i.baseAbbr !== i.pickAbbr
      ? `Grundtipp ${i.baseAbbr}${pctOf(i.baseProb) ? ` ${pctOf(i.baseProb)}` : ""}`
      : "Favorit laut Quote";
  const first = [base, i.spread].filter(Boolean).join(", ");
  const n = i.maxDeviations;
  const allowed = `erlaubt ${n === 1 ? "ist" : "sind"} diese Woche ${n} ${n === 1 ? "Abweichung" : "Abweichungen"}`;
  const why =
    i.gap === null
      ? ""
      : i.gap > 0
        ? ` wegen ${i.gap} ${i.gap === 1 ? "Punkt" : "Punkten"} Rückstand auf Platz 1`
        : " trotz Führung";
  const pick = `${i.pickAbbr}${pctOf(i.pickProb) ? ` ${pctOf(i.pickProb)}` : ""}`;
  return `${first}. Bewusster Aussenseitertipp ${pick}, ${allowed}${why}.`;
}

/**
 * Kurzer, verständlicher Text zu einem Ladefehler. Der technische Text mit Dateiname bleibt in den
 * einklappbaren Details.
 */
export function friendlyLoadError(message: string): string {
  if (/Zeitüberschreitung/.test(message)) return "Die Verbindung war zu langsam.";
  if (/Netzwerkfehler/.test(message)) return "Keine Verbindung zum Server.";
  if (/HTTP 404/.test(message)) return "Ein Teil der Daten fehlt gerade.";
  if (/HTTP/.test(message)) return "Der Server hat nicht geantwortet.";
  if (/Format|JSON/.test(message)) return "Die Daten sind unvollständig, vermutlich läuft gerade eine Aktualisierung.";
  return "Unerwarteter Fehler.";
}
