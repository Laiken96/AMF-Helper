import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Game, Team } from "../core/schema";
import { groupBySlot } from "../core/time";
import { currentRef, loadWeekData, navWeeks, parseWeekKey, prefetchNeighbours, useKeptLoad, type WeekData } from "./data";
import { periodText, useLastPlays, useLiveScores, type LiveGame, type LiveState } from "./live";
import { LoadErrorNotice, PageHeader, TeamBadge, WeekStepper, fallbackTeam, fetchedFormat, weekLabel } from "./ui";

const STATUS_TEXT: Record<Game["status"], string> = {
  scheduled: "Geplant",
  in_progress: "Läuft",
  final: "Final",
  postponed: "Verschoben",
  canceled: "Abgesagt",
};

export const clockFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Reiter Spiele: Spielplan der gewählten Woche mit Liveticker für laufende Spiele. */
export function GamesView({ arg }: { arg: string | null }) {
  const { data, error, pending } = useKeptLoad(`spiele:${arg ?? ""}`, () => loadWeekData(parseWeekKey(arg)));

  useEffect(() => {
    if (data) prefetchNeighbours(data, loadWeekData);
  }, [data]);

  if (error) return <LoadErrorNotice message={error} />;
  if (!data) return <p className="notice">Daten werden geladen …</p>;
  return <GamesWeek key={`${data.ref.season}-${data.ref.seasonType}-${data.ref.week}`} data={data} pending={pending} />;
}

const KICKER: Record<WeekData["phase"], string> = { aktuell: "Spiele · Aktuell", vergangen: "Spiele · Vorbei", kommend: "Spiele · Nächste" };

function GamesWeek({ data, pending }: { data: WeekData; pending: boolean }) {
  const { week, teams, ref, phase } = data;
  const teamById = useMemo(() => new Map(teams.teams.map((t) => [t.id, t])), [teams]);
  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const live = useLiveScores(phase === "vergangen" ? null : ref, week?.games ?? null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const weeks = navWeeks(data);

  const header = (
    <PageHeader
      kicker={weeks ? KICKER[phase] : "Spiele"}
      title={weekLabel(ref)}
      aside={
        weeks ? (
          <WeekStepper view="spiele" weeks={weeks} value={ref} current={currentRef(data.current)} pending={pending} />
        ) : undefined
      }
      meta={
        week
          ? `Saison ${week.season} · Letzte Änderung ${fetchedFormat.format(new Date(week.fetchedAt))}`
          : `Saison ${ref.season}`
      }
    />
  );

  if (!week) {
    return (
      <>
        {header}
        <p className="notice">Für {weekLabel(ref)} liegt noch kein Spielplan vor.</p>
      </>
    );
  }

  const detailGame = detailId ? week.games.find((g) => g.id === detailId) : undefined;
  const detailLive = detailId ? live.games.get(detailId) : undefined;

  return (
    <>
      {header}
      <LiveStatus live={live} />
      <ScheduleList games={week.games} byeTeamIds={week.byeTeamIds} team={team} live={live} onOpen={setDetailId} />
      {detailGame && detailLive && (
        <LiveDetail game={detailGame} live={detailLive} team={team} stale={live.error} onClose={() => setDetailId(null)} />
      )}
    </>
  );
}

/** Hinweis zum Live Stand. Fehler behalten den letzten Stand (D042 Stream Frontend 2). */
export function LiveStatus({ live }: { live: LiveState }) {
  if (!live.active && !live.error) return null;
  if (live.error) {
    return (
      <p className="notice notice-pending live-status" role="status">
        Live Daten gerade nicht erreichbar.{" "}
        {live.updatedAt ? `Angezeigt wird der Stand von ${clockFormat.format(live.updatedAt)}.` : "Angezeigt wird der Spielplan."}
      </p>
    );
  }
  return (
    <p className="live-status live-status-ok">
      <span className="live-dot" aria-hidden="true" />
      Live, aktualisiert alle 20 Sekunden
      {live.updatedAt ? `, zuletzt ${clockFormat.format(live.updatedAt)}` : ""}
    </p>
  );
}

/** Spielplan nach Kickoff Slot. Laufende Spiele mit Live Stand, antippbar für die Detailansicht. */
export function ScheduleList({
  games,
  byeTeamIds,
  team,
  live,
  onOpen,
}: {
  games: readonly Game[];
  byeTeamIds: readonly string[];
  team: (id: string) => Team;
  live?: LiveState;
  onOpen?: (gameId: string) => void;
}) {
  const slots = groupBySlot(games);
  const byeTeams = byeTeamIds.map(team);
  return (
    <>
      {games.length === 0 ? (
        <p className="notice">Diese Woche sind keine Spiele angesetzt.</p>
      ) : (
        slots.map((slot) => (
          <section key={slot.slotKey} className="slot">
            <h2>{slot.label}</h2>
            <ul className="games">
              {slot.games.map((game) => (
                <GameRow key={game.id} game={game} team={team} live={live?.games.get(game.id)} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ))
      )}
      {byeTeams.length > 0 && (
        <section className="slot">
          <h2>Spielfrei</h2>
          <ul className="byes">
            {byeTeams.map((t) => (
              <li key={t.id}>
                <TeamBadge team={t} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const Possession = ({ on }: { on: boolean }) =>
  on ? (
    <span className="possession" title="Ballbesitz">
      <span className="sr-only">Ballbesitz</span>
    </span>
  ) : null;

function GameRow({
  game,
  team,
  live,
  onOpen,
}: {
  game: Game;
  team: (id: string) => Team;
  live: LiveGame | undefined;
  onOpen?: (gameId: string) => void;
}) {
  const away = team(game.awayId);
  const home = team(game.homeId);
  const running = live?.state === "in";
  const awayScore = live && live.state !== "pre" ? live.awayScore : game.awayScore;
  const homeScore = live && live.state !== "pre" ? live.homeScore : game.homeScore;
  const status = live && live.state !== "pre" ? (running ? "in_progress" : "final") : game.status;
  const showScore = (status === "in_progress" || status === "final") && awayScore !== null && homeScore !== null;
  const statusText = running
    ? periodText(live)
    : live?.state === "post"
      ? (live.detail ?? STATUS_TEXT.final)
      : game.status === "scheduled"
        ? STATUS_TEXT.scheduled
        : game.statusDetail || STATUS_TEXT[game.status];

  const matchup = (
    <div className="matchup">
      <span className="team-wrap">
        <TeamBadge team={away} />
        <Possession on={running && live.possessionTeamId === away.id} />
      </span>
      {showScore ? (
        <span className="score">
          {awayScore} : {homeScore}
        </span>
      ) : (
        <span className="at">@</span>
      )}
      <span className="team-wrap team-wrap-home">
        <Possession on={running && live.possessionTeamId === home.id} />
        <TeamBadge team={home} />
      </span>
    </div>
  );

  if (running && onOpen) {
    return (
      <li className="game status-in_progress game-live" data-anchor={game.id}>
        <button
          type="button"
          className="game-btn"
          aria-haspopup="dialog"
          aria-label={`${away.abbr} ${awayScore ?? 0} zu ${homeScore ?? 0} ${home.abbr}, ${statusText}. Letzte Spielzüge anzeigen`}
          onClick={() => onOpen(game.id)}
        >
          {matchup}
          <span className="details">
            <span>
              {live.downDistance ?? ""}
              {live.redZone && <span className="redzone"> Red Zone</span>}
            </span>
            <span className="status live-tag">
              <span className="live-dot" aria-hidden="true" />
              {statusText}
            </span>
          </span>
          {live.lastPlay && <span className="last-play">{live.lastPlay}</span>}
        </button>
      </li>
    );
  }

  return (
    <li className={`game status-${status}`} data-anchor={game.id}>
      {matchup}
      <div className="details">
        <span>{game.venue ?? ""}</span>
        <span className="status">{statusText}</span>
      </div>
    </li>
  );
}

/** Detail eines laufenden Spiels mit den letzten 10 Spielzügen aus dem ESPN Summary. */
function LiveDetail({
  game,
  live,
  team,
  stale,
  onClose,
}: {
  game: Game;
  live: LiveGame;
  team: (id: string) => Team;
  stale: boolean;
  onClose: () => void;
}) {
  const away = team(game.awayId);
  const home = team(game.homeId);
  const plays = useLastPlays(game.id, live.state === "in");
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Fokus beim Öffnen auf Schliessen, beim Schliessen zurück auf die Spielzeile
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const possession = live.possessionTeamId ? team(live.possessionTeamId) : null;
  const titleId = `live-title-${game.id}`;

  // Portal an body, damit das Overlay nicht von den Spaltenregeln der Seite (wide) beschnitten wird
  return createPortal(
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-card live-detail" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="overlay-head">
          <h1 id={titleId}>
            {away.abbr} @ {home.abbr}
          </h1>
          <button ref={closeRef} type="button" className="btn btn-close" onClick={onClose}>
            Schliessen
          </button>
        </div>
        <div className="live-board">
          <div className="live-board-team">
            <span className="hero-abbr">{away.abbr}</span>
            <span className="live-board-score">{live.awayScore ?? "0"}</span>
          </div>
          <div className="live-board-mid">
            {live.state === "in" ? (
              <span className="live-tag">
                <span className="live-dot" aria-hidden="true" />
                {periodText(live)}
              </span>
            ) : (
              <span>{live.detail ?? "Final"}</span>
            )}
          </div>
          <div className="live-board-team live-board-home">
            <span className="hero-abbr">{home.abbr}</span>
            <span className="live-board-score">{live.homeScore ?? "0"}</span>
          </div>
        </div>
        {(possession || live.downDistance) && (
          <p className="live-situation">
            {possession && `Ballbesitz ${possession.abbr}`}
            {possession && live.downDistance && ", "}
            {live.downDistance}
            {live.redZone && ", Red Zone"}
          </p>
        )}
        <section aria-label="Letzte Spielzüge">
          <h2>Letzte Spielzüge</h2>
          {(plays.error || stale) && (
            <p className="push-hint" role="status">
              Aktualisierung fehlgeschlagen.{" "}
              {plays.updatedAt ? `Stand ${clockFormat.format(plays.updatedAt)}.` : "Neuer Versuch in 20 Sekunden."}
            </p>
          )}
          {plays.plays === null ? (
            !plays.error && <p className="push-hint">Spielzüge werden geladen …</p>
          ) : plays.plays.length === 0 ? (
            <p className="push-hint">Noch keine Spielzüge.</p>
          ) : (
            <ol className="plays">
              {plays.plays.map((p) => (
                <li key={p.id} className={p.scoring ? "play play-score" : "play"}>
                  <span className="play-when">
                    {p.period ? (p.period > 4 ? "OT" : `Q${p.period}`) : ""} {p.clock ?? ""}
                    {p.teamId && <span className="play-team"> {team(p.teamId).abbr}</span>}
                  </span>
                  <span className="play-text">{p.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
