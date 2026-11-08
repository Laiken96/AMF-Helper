// Spielansicht für geplante und beendete Spiele (D056). Reine Funktionen ohne React, direkt testbar.
// Kopfzeilen, Ergebnis des Tipps, Sieger, Bilanz und der Knopf für die eigene Abweichung (D052).
import { favoriteOf } from "../core/deviation";
import { tipResult, type TipResult } from "../core/review";
import type { Game } from "../core/schema";
import { formatKickoffZurich } from "../core/time";
import type { GameTip } from "../core/tips-schema";
import { periodText, type LiveGame } from "./live";
import type { LiveSummary } from "./live-summary";
import { choiceLocked } from "./player";
import { formatCountdown, statusWord } from "./wording";

/** Kickoff in Schweizer Zeit, "So 08.11. · 15:30 Uhr". */
export function kickoffLine(iso: string): string {
  return `${formatKickoffZurich(iso).replace(/ (\d\d:\d\d)$/, " · $1")} Uhr`;
}

/** "Kickoff in 4 Tg 18 h", nach Kickoff "Kickoff vorbei". */
export function kickoffCountdown(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  return ms > 0 ? `Kickoff in ${formatCountdown(ms)}` : "Kickoff vorbei";
}

export type WinnerSide = "away" | "home" | "tie";

/** Sieger aus dem Spielstand, null ohne vollständigen Stand. */
export function winnerSide(awayScore: number | null, homeScore: number | null): WinnerSide | null {
  if (awayScore === null || homeScore === null) return null;
  if (awayScore === homeScore) return "tie";
  return awayScore > homeScore ? "away" : "home";
}

/**
 * Ergebnis des angezeigten Tipps. Ein Endstand aus Live Daten zählt auch, bevor die Wochendatei final ist.
 * "offen" erscheint nie, solange das Spiel nicht beendet ist, gibt es kein Ergebnis.
 */
export function shownResult(
  tip: GameTip | undefined,
  game: Game,
  final: boolean,
  awayScore: number | null,
  homeScore: number | null,
  now: number,
): Exclude<TipResult, "offen"> | null {
  if (!tip) return null;
  // Ohne echten Tipp (offen oder vor App Start) gibt es kein Ergebnis zum Tipp
  if (tip.level === "offen" || tip.level === "nicht_erfasst") return null;
  const result = tipResult(tip, game, tip.kickoffUtc, new Date(now).toISOString());
  if (result === "ungewertet") return result;
  const side = final ? winnerSide(awayScore, homeScore) : null;
  if (side && tip.pickTeamId) {
    if (side === "tie") return "unentschieden";
    return (side === "away" ? game.awayId : game.homeId) === tip.pickTeamId ? "richtig" : "falsch";
  }
  return result === "offen" ? null : result;
}

/** Text zum Ergebnis, mit Kürzel des getippten Teams. Nie nur Farbe. */
export function resultText(result: Exclude<TipResult, "offen" | null>, pickAbbr: string | null): string {
  const who = pickAbbr ? `Dein Tipp ${pickAbbr}` : "Dein Tipp";
  switch (result) {
    case "richtig":
      return `${who} richtig`;
    case "falsch":
      return `${who} falsch`;
    case "unentschieden":
      return "Unentschieden, zählt als falsch";
    case "ungewertet":
      return "Spiel ungewertet";
  }
}

/** Bilanz der Teams: Summary vor Scoreboard, sonst null. */
export function teamRecords(
  summary: Pick<LiveSummary, "teams"> | null | undefined,
  live: Pick<LiveGame, "extra"> | null | undefined,
  awayId: string,
  homeId: string,
): { away: string | null; home: string | null } {
  const of = (id: string) => summary?.teams.find((t) => t.id === id)?.record ?? null;
  return {
    away: of(awayId) ?? live?.extra?.awayRecord ?? null,
    home: of(homeId) ?? live?.extra?.homeRecord ?? null,
  };
}

/** Punkte je Viertel: Summary vor Scoreboard. */
export function teamLines(
  summary: Pick<LiveSummary, "teams"> | null | undefined,
  live: Pick<LiveGame, "extra"> | null | undefined,
  awayId: string,
  homeId: string,
): { away: (number | null)[]; home: (number | null)[] } {
  const of = (id: string) => summary?.teams.find((t) => t.id === id)?.lines ?? [];
  const away = of(awayId);
  const home = of(homeId);
  return {
    away: away.length ? away : (live?.extra?.awayLines ?? []),
    home: home.length ? home : (live?.extra?.homeLines ?? []),
  };
}

/** TV Sender: Scoreboard vor Summary, null ohne Angabe. */
export function tvText(
  summary: Pick<LiveSummary, "info"> | null | undefined,
  live: Pick<LiveGame, "extra"> | null | undefined,
): string | null {
  return live?.extra?.broadcast ?? (summary?.info.tv.length ? summary.info.tv.join(", ") : null);
}

export interface OutsiderChoice {
  favoriteId: string;
  underdogId: string;
  /** Kickoff vorbei, Tipp gesperrt oder Spiel nicht mehr geplant. */
  locked: boolean;
}

/**
 * Grundlage für den Knopf "Aussenseiter tippen" (D052): Favorit aus pHome, wie im Blatt der Tipps.
 * Null ohne Quote oder ohne Tipp der App.
 */
export function outsiderChoice(
  tip: Pick<GameTip, "pHome" | "pickTeamId" | "level" | "locked"> | null | undefined,
  game: Pick<Game, "homeId" | "awayId" | "kickoffUtc" | "status">,
  now: number,
): OutsiderChoice | null {
  if (!tip || tip.pHome === null || tip.pickTeamId === null) return null;
  if (tip.level === "offen" || tip.level === "nicht_erfasst") return null;
  const fav = favoriteOf(tip, game);
  if (!fav) return null;
  return { favoriteId: fav.favoriteId, underdogId: fav.underdogId, locked: choiceLocked(tip, game, new Date(now).toISOString()) };
}

const STATUS_TEXT: Record<Game["status"], string> = {
  scheduled: "Geplant",
  in_progress: "Läuft",
  final: "Beendet",
  postponed: "Verschoben",
  canceled: "Abgesagt",
};

/** Anzeigestand eines Spiels aus Wochendatei und Live Daten. Verschoben und abgesagt gelten weder laufend noch final. */
export function gameState(game: Game, live: LiveGame | undefined) {
  const offStatus =
    live?.status === "postponed" || live?.status === "canceled"
      ? live.status
      : game.status === "postponed" || game.status === "canceled"
        ? game.status
        : null;
  const running = !offStatus && live?.state === "in";
  const fromLive = !offStatus && live !== undefined && live.state !== "pre";
  const awayScore = fromLive ? live.awayScore : game.awayScore;
  const homeScore = fromLive ? live.homeScore : game.homeScore;
  const status: Game["status"] = offStatus ?? (fromLive ? (running ? "in_progress" : "final") : game.status);
  const showScore = (status === "in_progress" || status === "final") && awayScore !== null && homeScore !== null;
  const statusText = offStatus
    ? STATUS_TEXT[offStatus]
    : running
      ? statusWord(periodText(live))
      : live?.state === "post"
        ? statusWord(live.detail) || STATUS_TEXT.final
        : game.status === "scheduled"
          ? STATUS_TEXT.scheduled
          : statusWord(game.statusDetail) || STATUS_TEXT[game.status];
  return { running, awayScore, homeScore, status, showScore, statusText };
}

const LEVEL_WORD: Record<GameTip["level"], string> = {
  klar: "klar",
  favorit: "Favorit",
  unklar: "unklar",
  offen: "offen",
  nicht_erfasst: "nicht erfasst",
};

/**
 * Marke neben der Siegchance. Die Lage (klar, Favorit, unklar) beschreibt den Favoriten. Bei einer Abweichung
 * steht stattdessen die Abweichung, sonst stünde "klar" neben z. B. 22 %. short für die Tippliste.
 */
export function levelLabel(tip: Pick<GameTip, "level" | "deviation">, own: boolean, short = false): string {
  if (tip.deviation && tip.level !== "offen" && tip.level !== "nicht_erfasst") {
    if (short) return own ? "deine Abw." : "Abw.";
    return own ? "deine Abweichung" : "Abweichung";
  }
  return LEVEL_WORD[tip.level];
}

/** Ergebnis als Text und Farbklasse, gleich in Tippliste, Spielansicht und Bilanz. Unentschieden zählt als falsch. */
export const RESULT_BADGE: Record<Exclude<TipResult, null>, { text: string; cls: string }> = {
  richtig: { text: "richtig", cls: "res-badge res-badge-richtig" },
  falsch: { text: "falsch", cls: "res-badge res-badge-falsch" },
  unentschieden: { text: "unentschieden", cls: "res-badge res-badge-unentschieden" },
  offen: { text: "offen", cls: "res-badge res-badge-offen" },
  ungewertet: { text: "ungewertet", cls: "res-badge res-badge-ungewertet" },
};

/** Ergebnis einer Bilanzzeile. Final ohne Sieger ist unentschieden. */
export function reviewResult(row: { final: boolean; pickTeamId: string | null; correct: boolean | null; winnerTeamId: string | null }): TipResult {
  if (row.pickTeamId === null) return null;
  if (!row.final || row.correct === null) return "offen";
  if (row.winnerTeamId === null) return "unentschieden";
  return row.correct ? "richtig" : "falsch";
}

/**
 * Spiel mit Endstand aus den Live Daten, solange die Wochendatei es noch nicht als beendet führt. So zeigen
 * Tippliste, Spielbereich und Spielansicht gleichzeitig richtig oder falsch.
 */
export function withLiveFinal(game: Game, live: LiveGame | undefined): Game {
  if (!live || game.status === "final") return game;
  const st = gameState(game, live);
  if (st.status !== "final" || !st.showScore) return game;
  return { ...game, status: "final", awayScore: st.awayScore, homeScore: st.homeScore, statusDetail: live.detail ?? game.statusDetail };
}

export type EntryStatus = "none" | "done" | "changed";

/**
 * Zeile zählt als offen (Filter Offen, Zähler): nicht gesperrt, mit App Tipp, Häkchen fehlt oder Tipp geändert.
 * Gesperrte Zeilen zählen nie, eintragen geht nicht mehr. Der Hinweis "Tipp geändert" bleibt in der Zeile.
 */
export function entryPending(row: Pick<GameTip, "locked" | "level">, status: EntryStatus, passive: boolean): boolean {
  if (passive || row.locked || row.level === "nicht_erfasst") return false;
  return status === "changed" || status === "none";
}
