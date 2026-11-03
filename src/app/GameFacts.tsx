import { useId, useState, type ReactNode } from "react";
import type { Game, Team } from "../core/schema";
import { deviationCandidate } from "../core/deviation";
import { isLocked } from "../core/tips";
import type { GameTip } from "../core/tips-schema";
import { useFactsData } from "./data";
import { absenceText, candidateText, deviationSignals, fpiFact, keyAbsence, marketFact, picksFact, venueFact } from "./facts";
import { Spoken } from "./ui";

const OPEN_KEY = "nfl-facts-open";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    if (open) window.localStorage.setItem(OPEN_KEY, "1");
    else window.localStorage.removeItem(OPEN_KEY);
  } catch {
    // Ohne Speicher bleibt die Wahl nur bis zum Neuladen
  }
}

export const FlagIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 8v5" />
    <path d="M12 16.5h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={open ? "facts-chevron facts-chevron-open" : "facts-chevron"}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const Sep = () => (
  <span className="facts-sep" aria-hidden="true">
    ·
  </span>
);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="facts-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Alle Fakten eines Spiels, geteilt von Spielbereich (Tipps) und Spielansicht (Spiele, D056). */
export function useGameFactsModel(game: Game, tip: GameTip | null | undefined, team: (id: string) => Team, now: number) {
  const facts = useFactsData(tip ? { season: game.season, seasonType: game.seasonType, week: game.week } : null);
  const abbr = (teamId: string) => team(teamId).abbr;
  const fpiGame = facts?.fpi?.games.find((g) => g.gameId === game.id);
  const picksGame = facts?.picks?.games.find((g) => g.gameId === game.id);
  const market = marketFact(tip, game, abbr);
  const fpi = fpiFact(fpiGame, game, tip, abbr);
  const picks = picksFact(picksGame, game, tip, abbr);
  const venue = venueFact(game, abbr);
  const pickId = tip && tip.level !== "offen" && tip.level !== "nicht_erfasst" ? tip.pickTeamId : null;

  // Kandidat und Signale (D052): aus dem Vorschlag der App (pHome), nicht aus der eigenen Wahl
  const nowIso = new Date(now).toISOString();
  const tipOpen = Boolean(tip) && !tip!.locked && !isLocked(game, nowIso);
  const candidate = tip ? deviationCandidate(tip, game, picksGame, nowIso) : null;
  const signals =
    tip && tipOpen ? deviationSignals({ tip, game, fpi: fpiGame, injuries: facts?.injuries, abbr }) : [];
  const suggestionId = tip && tip.pHome !== null ? (tip.pHome >= 0.5 ? game.homeId : game.awayId) : null;
  // Ausfälle beim Spiel: wichtigster Ausfall je Team, nur wenn der Wächter das Spiel erfasst hat
  const injuryGame = facts?.injuries?.current.games.find((g) => g.gameId === game.id);
  const absences = injuryGame
    ? [game.awayId, game.homeId].flatMap((id) => {
        const p = keyAbsence(facts?.injuries, game.id, id);
        return p ? [{ teamId: id, text: absenceText(p) }] : [];
      })
    : null;
  return { market, fpi, picks, venue, pickId, candidate, signals, suggestionId, absences, tipOpen, abbr };
}

export type GameFactsModel = ReturnType<typeof useGameFactsModel>;

/**
 * Block Fakten im Spielbereich der Tipps (D050): Markt mit Linienbewegung, ESPN FPI, Tippverteilung ESPN Pick'em,
 * Spielort und Ruhetage. Dazu der Hinweis "Abweichung möglich" mit Signalen und die eigene Abweichung (D052).
 * Markt sichtbar, der Rest einklappbar. FPI, Tippverteilung und Ausfälle werden nur mit Tippdatei geladen.
 */
export function GameFacts({
  game,
  tip,
  team,
  now,
  own = false,
}: {
  game: Game;
  tip: GameTip | null | undefined;
  team: (id: string) => Team;
  /** Zeit in ms für die Sperre ab Kickoff. */
  now: number;
  /** true, wenn der angezeigte Tipp die eigene Abweichung ist. */
  own?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(readOpen);
  const { market, fpi, picks, venue, pickId, candidate, signals, suggestionId, abbr } = useGameFactsModel(game, tip, team, now);
  const away = team(game.awayId);
  const home = team(game.homeId);
  const choice =
    candidate || (own && pickId) || signals.length > 0 ? (
      <div className="facts-choice" role="group" aria-label="Abweichung">
        {own && pickId && (
          <p className="facts-choice-line">
            <span className="facts-choice-tag facts-choice-own">Deine Abweichung</span> Du tippst {abbr(pickId)}
            {suggestionId && suggestionId !== pickId ? `, Vorschlag der App ist ${abbr(suggestionId)}.` : "."}
          </p>
        )}
        {candidate && (
          <p className="facts-choice-line">
            <span className="facts-choice-tag">Abweichung möglich</span> {candidateText(candidate, abbr)}
          </p>
        )}
        {signals.length > 0 && (
          <ul className="facts-signals" aria-label="Signale für den Aussenseiter">
            {signals.map((sig) => (
              <li key={sig.kind}>
                <FlagIcon />
                <span>{sig.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  const marketRow = market && (
    <Row label="Markt">
      <Spoken
        shown={
          <>
            {market.prob && <span className="facts-strong facts-nowrap">{market.prob}</span>}
            {market.prob && market.line && <Sep />}
            {market.line && <span className="facts-nowrap">{market.line}</span>}
            {market.start && (
              <>
                {", "}
                <span className="facts-move">{market.start}</span>
              </>
            )}
          </>
        }
        spoken={market.spoken}
      />
    </Row>
  );

  const fpiRow = fpi && (
    <Row label="ESPN FPI">
      <span className="facts-strong">
        {fpi.abbr} {fpi.pct} %
      </span>
      {fpi.large && fpi.gapText && (
        <>
          {" "}
          <span className="facts-flag">
            <FlagIcon />
            {fpi.gapText}
          </span>
        </>
      )}
      <span className="facts-note">Modell, nur zum Vergleich</span>
    </Row>
  );

  const picksRow = picks && (
    <Row label="ESPN Tipps">
      <span className="facts-strong">{picks.headline}</span>
      <span className="facts-bar" aria-hidden="true">
        <span
          className={pickId === away.id ? "facts-bar-seg facts-bar-pick" : "facts-bar-seg"}
          style={{ width: `${picks.awayPct}%` }}
        />
        <span
          className={pickId === home.id ? "facts-bar-seg facts-bar-pick" : "facts-bar-seg"}
          style={{ width: `${picks.homePct}%` }}
        />
      </span>
      <span className="facts-bar-ends" aria-hidden="true">
        <span>
          {away.abbr} {picks.awayPct} %
        </span>
        <span>
          {home.abbr} {picks.homePct} %
        </span>
      </span>
      <span className="sr-only">
        {away.abbr} {picks.awayPct} Prozent, {home.abbr} {picks.homePct} Prozent.
      </span>
      {picks.pickNote && <span className="facts-pick-note">{picks.pickNote}</span>}
      <span className="facts-note">{picks.sample}</span>
    </Row>
  );

  const placeRow = venue && (venue.place || venue.neutral) && (
    <Row label="Ort">
      {venue.place && <span>{venue.place}</span>}
      {venue.neutral && (
        <>
          {venue.place && " "}
          <span className="facts-tag">neutraler Platz</span>
        </>
      )}
    </Row>
  );

  const restRow = venue?.rest && (
    <Row label="Ruhetage">
      <span>{venue.rest}</span>
      {venue.short && (
        <>
          {" "}
          <span className="facts-flag">
            <FlagIcon />
            {venue.short}
          </span>
        </>
      )}
    </Row>
  );

  const more = [fpiRow, picksRow, placeRow, restRow].filter(Boolean);
  if (!marketRow && more.length === 0 && !choice) return null;

  const toggle = () => {
    setOpen((o) => {
      writeOpen(!o);
      return !o;
    });
  };
  return (
    <section aria-label="Fakten" className="facts facts-hero">
      {choice}
      {marketRow && <dl className="facts-list">{marketRow}</dl>}
      {more.length > 0 && (
        <>
          {open && (
            <dl className="facts-list" id={id}>
              {more}
            </dl>
          )}
          <button type="button" className="facts-toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
            {open ? "Weniger Fakten" : "Mehr Fakten"}
            <Chevron open={open} />
          </button>
        </>
      )}
    </section>
  );
}
