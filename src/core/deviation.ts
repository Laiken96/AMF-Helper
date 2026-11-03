// Kandidaten "Abweichung möglich" (D052). Reine Funktionen ohne IO, nutzbar in App und Jobs.
// Die App wählt keine Abweichung selbst. Sie markiert nur Spiele, bei denen eine eigene Abweichung des Nutzers
// überlegenswert ist: nicht gesperrt, Favorit unter 60 Prozent (Lage unklar) und, sobald die ESPN Tippverteilung
// vorliegt, ein Aussenseiter, den höchstens 35 Prozent der ESPN Tipps wählen. Nur selten getippte Aussenseiter
// bringen in der Gruppe einen Vorsprung, wenn sie gewinnen.
import type { GamePicks, PicksFile } from "./picks";
import type { Game } from "./schema";
import { LEVEL_FAVORIT, isLocked, roundProb } from "./tips";
import type { GameTip, TipsFile } from "./tips-schema";

/** Höchster Anteil der ESPN Tipps auf den Aussenseiter, damit das Spiel Kandidat bleibt. */
export const CANDIDATE_MAX_UNDERDOG_SHARE = 0.35;

export interface DeviationCandidate {
  gameId: string;
  favoriteId: string;
  underdogId: string;
  /** Siegwahrscheinlichkeit des Favoriten laut Markt. */
  favoriteProb: number;
  /** Anteil der ESPN Tipps auf den Aussenseiter, null ohne Tippverteilung. */
  underdogShare: number | null;
  /** true, wenn keine Tippverteilung für das Spiel vorliegt. Dann reicht die Lage unklar. */
  withoutPicks: boolean;
}

/** Favorit und Aussenseiter aus pHome, bei exakt 0.5 das Heimteam als Favorit wie im Job. */
export function favoriteOf(
  tip: Pick<GameTip, "pHome">,
  game: Pick<Game, "homeId" | "awayId">,
): { favoriteId: string; underdogId: string; favoriteProb: number } | null {
  if (tip.pHome === null) return null;
  const home = tip.pHome >= 0.5;
  return {
    favoriteId: home ? game.homeId : game.awayId,
    underdogId: home ? game.awayId : game.homeId,
    favoriteProb: home ? tip.pHome : roundProb(1 - tip.pHome),
  };
}

/**
 * Prüft ein Spiel. Null, wenn es kein Kandidat ist. Tippverteilungen zu anderen Teams gelten als fehlend.
 * Gesperrt heisst Tipp gesperrt, Kickoff vorbei oder Spiel nicht mehr geplant.
 */
export function deviationCandidate(
  tip: Pick<GameTip, "gameId" | "pHome" | "level" | "locked">,
  game: Pick<Game, "id" | "homeId" | "awayId" | "kickoffUtc" | "status">,
  picks: Pick<GamePicks, "homeId" | "awayId" | "homeShare" | "awayShare" | "total"> | null | undefined,
  now: string,
): DeviationCandidate | null {
  if (tip.locked || isLocked(game, now)) return null;
  if (tip.level === "offen" || tip.level === "nicht_erfasst") return null;
  const fav = favoriteOf(tip, game);
  if (!fav || fav.favoriteProb >= LEVEL_FAVORIT) return null;
  const usable = picks && picks.homeId === game.homeId && picks.awayId === game.awayId && picks.total > 0;
  const underdogShare = usable ? (fav.underdogId === game.homeId ? picks.homeShare : picks.awayShare) : null;
  if (underdogShare !== null && underdogShare > CANDIDATE_MAX_UNDERDOG_SHARE) return null;
  return { gameId: game.id, ...fav, underdogShare, withoutPicks: underdogShare === null };
}

/** Alle Kandidaten einer Woche, nach gameId. Spiele ohne Eintrag in der Wochendatei fallen weg. */
export function deviationCandidates(
  tips: Pick<TipsFile, "tips">,
  games: readonly Game[],
  picks: Pick<PicksFile, "games"> | null | undefined,
  now: string,
): Map<string, DeviationCandidate> {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const picksById = new Map((picks?.games ?? []).map((p) => [p.gameId, p]));
  const out = new Map<string, DeviationCandidate>();
  for (const tip of tips.tips) {
    const game = gameById.get(tip.gameId);
    if (!game) continue;
    const c = deviationCandidate(tip, game, picksById.get(tip.gameId), now);
    if (c) out.set(tip.gameId, c);
  }
  return out;
}
