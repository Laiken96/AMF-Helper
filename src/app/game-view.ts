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
  const result = tipResult(tip, game, tip.kickoffUtc, new Date(now).toISOString());
  if (result === "ungewertet") return result;
  const side = final ? winnerSide(awayScore, homeScore) : null;
  if (side && tip.pickTeamId && tip.level !== "nicht_erfasst" && tip.level !== "offen") {
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
