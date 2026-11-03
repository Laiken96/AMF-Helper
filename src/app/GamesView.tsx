import { useEffect, useMemo, useState } from "react";
import { tipResult, type TipResult } from "../core/review";
import type { Game, Team } from "../core/schema";
import type { GameTip, StandingsFile, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich, groupBySlot } from "../core/time";
import {
  beforeAppStart,
  currentRef,
  loadTipsData,
  loadWeekData,
  navWeeks,
  parseWeekKey,
  prefetchNeighbours,
  useKeptLoad,
  weekKey,
  type WeekData,
  type WeekRef,
} from "./data";
import { useNow } from "./GameHero";
import { useLayoutValue } from "./layout";
import { GameFacts } from "./GameFacts";
import { GameSheet } from "./Sheet";
import { useChoices, usePlayer, useShownTips } from "./player";
import { periodText, useLastPlays, useLiveScores, useLiveSummaries, type LiveGame, type LiveState } from "./live";
import { LiveCarousel, LiveTicker } from "./LiveTicker";
import { LoadErrorNotice, PageHeader, TeamBadge, WeekStepper, fallbackTeam, weekLabel } from "./ui";
import { formatCountdown, formatStand, statusWord } from "./wording";

const STATUS_TEXT: Record<Game["status"], string> = {
  scheduled: "Geplant",
  in_progress: "Läuft",
  final: "Beendet",
  postponed: "Verschoben",
  canceled: "Abgesagt",
};

export const clockFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Reiter Spiele: Spielplan der gewählten Woche mit Liveticker für laufende Spiele. arg ist Woche und optional Spiel. */
export function GamesView({ arg }: { arg: string | null }) {
  const [weekArg = null, gameArg = null] = arg ? arg.split("/") : [];
  const { data, error, pending } = useKeptLoad(`spiele:${weekArg ?? ""}`, () => loadGamesData(parseWeekKey(weekArg)));

  useEffect(() => {
    if (data) prefetchNeighbours(data, loadGamesData);
  }, [data]);

  if (error) return <LoadErrorNotice message={error} />;
  if (!data) return <p className="notice">Daten werden geladen …</p>;
  return (
    <GamesWeek
      key={`${data.ref.season}-${data.ref.seasonType}-${data.ref.week}`}
      data={data}
      pending={pending}
      selectedId={gameArg}
    />
  );
}

type GamesData = WeekData & { tips: TipsFile | null; standings?: StandingsFile };

/** Wochendaten mit Tippliste für die Spielinfo. Fehlt die Tippliste oder scheitert ihr Laden, bleibt der Spielplan. */
function loadGamesData(ref: WeekRef | null = null): Promise<GamesData> {
  return loadTipsData(ref).catch(async () => ({ ...(await loadWeekData(ref)), tips: null }));
}

const KICKER: Record<WeekData["phase"], string> = { aktuell: "Spiele · Aktuell", vergangen: "Spiele · Vorbei", kommend: "Spiele · Nächste" };

function GamesWeek({ data, pending, selectedId }: { data: GamesData; pending: boolean; selectedId: string | null }) {
  const { week, teams, ref, phase } = data;
  const layout = useLayoutValue();
  const wide = layout === "wide";
  const now = useNow();
  const teamById = useMemo(() => new Map(teams.teams.map((t) => [t.id, t])), [teams]);
  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const live = useLiveScores(phase === "vergangen" ? null : ref, week?.games ?? null);
  const weeks = navWeeks(data);
  // Derselbe Tipp wie im Reiter Tipps: Vorschlag der App mit der eigenen Wahl des Spielers (D050, D052)
  const player = usePlayer(data.standings ?? null);
  const { choices } = useChoices(player.player, ref);
  const shownTips = useShownTips(data.tips, week?.games, data.standings ?? null, phase, player.player, choices);

  // Standardspiel für den Detailbereich: laufendes Spiel, sonst nächstes Spiel, sonst das letzte beendete
  const games = week?.games;
  const defaultId = useMemo(() => {
    if (!games || games.length === 0) return null;
    const sorted = [...games].sort(
      (a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.id.localeCompare(b.id),
    );
    const running = sorted.find((g) => gameState(g, live.games.get(g.id)).running);
    if (running) return running.id;
    const next = sorted.find((g) => g.status === "scheduled" && Date.parse(g.kickoffUtc) > now);
    if (next) return next.id;
    const last = [...sorted].reverse().find((g) => gameState(g, live.games.get(g.id)).status === "final");
    return (last ?? sorted[sorted.length - 1])?.id ?? null;
  }, [games, live.games, now]);

  // Laufende Spiele für den Ticker oben (D054), nach Kickoff sortiert
  const running = useMemo(
    () =>
      (games ?? [])
        .filter((g) => gameState(g, live.games.get(g.id)).running)
        .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.id.localeCompare(b.id)),
    [games, live.games],
  );
  const runningIds = running.map((g) => g.id);
  const nextGame = useMemo(
    () =>
      [...(games ?? [])]
        .filter((g) => g.status === "scheduled" && Date.parse(g.kickoffUtc) > now)
        .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc))[0] ?? null,
    [games, now],
  );
  // Karte im Karussell: Wahl aus dem Hash, sonst die zuletzt gezeigte, sonst die erste
  const [carouselPick, setCarouselPick] = useState<string | null>(null);
  const selectedRunning = selectedId && runningIds.includes(selectedId) ? selectedId : null;
  const activeRunning =
    selectedRunning ?? (carouselPick && runningIds.includes(carouselPick) ? carouselPick : (runningIds[0] ?? null));

  const selectedGame = selectedId ? games?.find((g) => g.id === selectedId) : undefined;
  const shownGame = selectedGame ?? (defaultId ? games?.find((g) => g.id === defaultId) : undefined);
  const shownId = shownGame?.id ?? null;
  // Summary nur für das gezeigte laufende Spiel: links im Duo quer, sonst die sichtbare Karte
  const summaryIds = wide ? (shownId && runningIds.includes(shownId) ? [shownId] : []) : activeRunning ? [activeRunning] : [];
  const summaries = useLiveSummaries(summaryIds);
  const baseHash = `#spiele/${weekKey(ref)}`;
  const select = (id: string | null) => {
    const target = id ? `${baseHash}/${id}` : baseHash;
    if (window.location.hash !== target) window.location.hash = target;
  };

  // wide: gewählte Zeile in der Liste sichtbar halten
  useEffect(() => {
    if (!wide || !shownId || !selectedId) return;
    document.querySelector(`[data-anchor="${CSS.escape(shownId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [wide, shownId, selectedId]);

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
          ? `Saison ${week.season} · ${formatStand(week.fetchedAt)}`
          : `Saison ${ref.season}`
      }
    />
  );

  if (!week) {
    return (
      <>
        {header}
        <p className="notice">
          {beforeAppStart(data.index, ref)
            ? `${weekLabel(ref)} liegt vor dem App Start, keine Daten.`
            : `Für ${weekLabel(ref)} liegt noch kein Spielplan vor.`}
        </p>
      </>
    );
  }

  const tipOf = (gameId: string) => shownTips?.tips.find((t) => t.gameId === gameId);
  const ownOf = (gameId: string) => Boolean(choices[gameId] && tipOf(gameId)?.deviation);
  const tickerFor = (g: Game) => {
    const lg = live.games.get(g.id);
    return lg ? (
      <LiveTicker
        game={g}
        live={lg}
        summary={summaries.get(g.id)}
        tip={tipOf(g.id)}
        team={team}
        tipsHref={`#tipps/${weekKey(ref)}/${g.id}`}
      />
    ) : null;
  };
  const matchupLabel = (g: Game) => {
    const lg = live.games.get(g.id);
    const a = team(g.awayId).abbr;
    const h = team(g.homeId).abbr;
    return lg && lg.awayScore !== null && lg.homeScore !== null ? `${a} ${lg.awayScore} zu ${lg.homeScore} ${h}` : `${a} gegen ${h}`;
  };
  const nextHint =
    running.length === 0 && nextGame && phase !== "vergangen" ? (
      <p className="notice tk-next">
        Gerade läuft kein Spiel. Nächstes Spiel {team(nextGame.awayId).abbr} @ {team(nextGame.homeId).abbr},{" "}
        {formatKickoffZurich(nextGame.kickoffUtc)} Uhr, in {formatCountdown(Date.parse(nextGame.kickoffUtc) - now)}.
      </p>
    ) : null;
  const list = (
    <ScheduleList
      games={week.games}
      byeTeamIds={week.byeTeamIds}
      team={team}
      live={live}
      onOpen={select}
      selectedId={wide ? shownId : null}
      selectAll
    />
  );

  if (wide) {
    return (
      <div className="duo-split">
        <div className="pane pane-detail">
          {shownGame && runningIds.includes(shownGame.id) && live.games.get(shownGame.id) ? (
            tickerFor(shownGame)
          ) : shownGame ? (
            <section className="game-detail-card" aria-label="Gewähltes Spiel">
              <GameDetail
                game={shownGame}
                live={live.games.get(shownGame.id)}
                tip={tipOf(shownGame.id)}
                own={ownOf(shownGame.id)}
                team={team}
                stale={live.error}
                now={now}
                tipsHref={`#tipps/${weekKey(ref)}/${shownGame.id}`}
              />
            </section>
          ) : (
            <p className="notice">Diese Woche sind keine Spiele angesetzt.</p>
          )}
        </div>
        <div className="fold" aria-hidden="true" />
        <div className="pane pane-list">
          {header}
          <LiveStatus live={live} />
          {nextHint}
          {list}
        </div>
      </div>
    );
  }

  // Übrige Spiele kompakt unter dem Ticker, laufende stehen oben als Karte
  const restList = running.length ? (
    <>
      {week.games.length > running.length && <h2 className="tk-rest-title">Weitere Spiele</h2>}
      <ScheduleList
        games={week.games.filter((g) => !runningIds.includes(g.id))}
        byeTeamIds={week.byeTeamIds}
        team={team}
        live={live}
        onOpen={select}
        selectAll
      />
    </>
  ) : (
    list
  );
  const sheetGame = selectedGame && !runningIds.includes(selectedGame.id) ? selectedGame : undefined;

  return (
    <>
      {header}
      <LiveStatus live={live} />
      {running.length > 0 && (
        <LiveCarousel
          items={running.map((g) => ({ id: g.id, label: matchupLabel(g) }))}
          activeId={activeRunning}
          onActive={(id) => {
            setCarouselPick(id);
            if (selectedRunning && selectedRunning !== id) select(null);
          }}
          render={(id) => {
            const g = running.find((x) => x.id === id);
            return g ? tickerFor(g) : null;
          }}
        />
      )}
      {nextHint}
      {restList}
      {sheetGame && (
        <GameSheet title={`${team(sheetGame.awayId).abbr} @ ${team(sheetGame.homeId).abbr}`} onClose={() => select(null)}>
          <section className="game-detail-card game-detail-sheet" aria-label="Spieldetail">
            <GameDetail
              game={sheetGame}
              live={live.games.get(sheetGame.id)}
              tip={tipOf(sheetGame.id)}
              own={ownOf(sheetGame.id)}
              team={team}
              stale={live.error}
              now={now}
              tipsHref={`#tipps/${weekKey(ref)}/${sheetGame.id}`}
              showHead={false}
            />
          </section>
        </GameSheet>
      )}
    </>
  );
}

/** Anzeigestand eines Spiels aus Wochendatei und Live Daten. Verschoben und abgesagt gelten weder laufend noch final. */
function gameState(game: Game, live: LiveGame | undefined) {
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

/** Spielplan nach Kickoff Slot. Mit onOpen sind die Spielzeilen antippbar, sonst nur laufende nicht. */
export function ScheduleList({
  games,
  byeTeamIds,
  team,
  live,
  onOpen,
  selectedId = null,
  selectAll = false,
}: {
  games: readonly Game[];
  byeTeamIds: readonly string[];
  team: (id: string) => Team;
  live?: LiveState;
  onOpen?: (gameId: string) => void;
  /** Im Detailbereich gezeigtes Spiel (wide), wird in der Liste markiert. */
  selectedId?: string | null;
  /** Alle Spielzeilen antippbar, nicht nur laufende. */
  selectAll?: boolean;
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
                <GameRow
                  key={game.id}
                  game={game}
                  team={team}
                  live={live?.games.get(game.id)}
                  onOpen={onOpen}
                  selected={game.id === selectedId}
                  selectAll={selectAll}
                />
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
  selected,
  selectAll,
}: {
  game: Game;
  team: (id: string) => Team;
  live: LiveGame | undefined;
  onOpen?: (gameId: string) => void;
  selected: boolean;
  selectAll: boolean;
}) {
  const away = team(game.awayId);
  const home = team(game.homeId);
  const { running, awayScore, homeScore, status, showScore, statusText } = gameState(game, live);
  const wide = useLayoutValue() === "wide";

  const matchup = (
    <div className="matchup">
      <span className="team-wrap">
        <TeamBadge team={away} />
        <Possession on={running && live?.possessionTeamId === away.id} />
      </span>
      {showScore ? (
        <span className="score">
          {awayScore} : {homeScore}
        </span>
      ) : (
        <span className="at">@</span>
      )}
      <span className="team-wrap team-wrap-home">
        <Possession on={running && live?.possessionTeamId === home.id} />
        <TeamBadge team={home} />
      </span>
    </div>
  );

  const scoreSpoken = showScore ? `${away.abbr} ${awayScore} zu ${homeScore} ${home.abbr}` : `${away.abbr} gegen ${home.abbr}`;
  // wide wählt das Spiel für den Detailbereich, sonst öffnet das Antippen das Detail als Blatt von unten
  const btnProps = {
    type: "button" as const,
    className: "game-btn",
    "aria-haspopup": wide ? undefined : ("dialog" as const),
    "aria-current": wide && selected ? (true as const) : undefined,
    onClick: () => onOpen?.(game.id),
  };
  const cls = (base: string) => `${base}${selected ? " selected" : ""}`;

  if (running && live && onOpen) {
    return (
      <li className={cls("game status-in_progress game-live")} data-anchor={game.id}>
        <button
          {...btnProps}
          aria-label={`${scoreSpoken}, ${statusText}. ${wide ? "Im Detail zeigen" : "Letzte Spielzüge anzeigen"}`}
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

  if (selectAll && onOpen) {
    return (
      <li className={cls(`game game-pick status-${status}`)} data-anchor={game.id}>
        <button {...btnProps} aria-label={`${scoreSpoken}, ${statusText}. ${wide ? "Im Detail zeigen" : "Spielinfo anzeigen"}`}>
          {matchup}
          <span className="details">
            <span>{game.venue ?? ""}</span>
            <span className="status">{statusText}</span>
          </span>
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

const LEVEL_TEXT: Record<GameTip["level"], string> = {
  klar: "klar",
  favorit: "Favorit",
  unklar: "unklar",
  offen: "offen",
  nicht_erfasst: "nicht erfasst",
};

const RESULT_TEXT: Record<Exclude<TipResult, null>, string> = {
  richtig: "Tipp richtig",
  falsch: "Tipp falsch",
  unentschieden: "Unentschieden, zählt als falsch",
  offen: "Tipp offen",
  ungewertet: "ungewertet",
};

function tipText(tip: GameTip | undefined, team: (id: string) => Team, own = false): string {
  if (!tip) return "keine Tippliste";
  if (tip.level === "nicht_erfasst") return "kein App Tipp, die App lief bei Kickoff noch nicht";
  if (tip.level === "offen" || !tip.pickTeamId) return "offen, noch keine Quote";
  const pct = tip.pickProb === null ? "" : `, ${Math.round(tip.pickProb * 100)} %`;
  return `${team(tip.pickTeamId).abbr}${pct}, ${LEVEL_TEXT[tip.level]}${tip.deviation ? (own ? ", deine Abweichung" : ", Abweichung") : ""}`;
}

/**
 * Inhalt des Spieldetails: Spielstand, bei laufendem Spiel Lage und letzte Spielzüge, sonst und zusätzlich
 * die Spielinfo mit Kickoff, Ort, Tipp und Endstand. Genutzt im Detailbereich (wide) und im Blatt.
 */
function GameDetail({
  game,
  live,
  tip,
  own = false,
  team,
  stale,
  now,
  tipsHref,
  showHead = true,
}: {
  game: Game;
  live: LiveGame | undefined;
  tip: GameTip | undefined;
  /** Angezeigter Tipp ist die eigene Abweichung (D052). */
  own?: boolean;
  team: (id: string) => Team;
  stale: boolean;
  now: number;
  tipsHref: string;
  /** Im Blatt steht die Paarung schon im Kopf des Blatts. */
  showHead?: boolean;
}) {
  const away = team(game.awayId);
  const home = team(game.homeId);
  const st = gameState(game, live);
  // Spielzüge nur bei Live Daten zu einem laufenden oder eben beendeten Spiel
  const withPlays = live !== undefined && st.status !== "postponed" && st.status !== "canceled" && live.state !== "pre";
  const plays = useLastPlays(withPlays ? game.id : null, st.running);
  const possession = st.running && live?.possessionTeamId ? team(live.possessionTeamId) : null;
  const final = st.status === "final" && st.showScore;
  const result = tip ? tipResult(tip, game, tip.kickoffUtc, new Date(now).toISOString()) : null;
  // Endstand aus Live Daten zählt auch, bevor die Wochendatei final ist
  const liveResult =
    final && tip && tip.pickTeamId && tip.level !== "nicht_erfasst" && st.awayScore !== null && st.homeScore !== null
      ? st.awayScore === st.homeScore
        ? "unentschieden"
        : (st.awayScore > st.homeScore ? game.awayId : game.homeId) === tip.pickTeamId
          ? "richtig"
          : "falsch"
      : null;
  const shownResult = result === "ungewertet" ? result : (liveResult ?? (result === "offen" ? null : result));

  return (
    <div className="game-detail">
      {showHead && (
        <div className="overlay-head game-detail-head">
          <h1>
            {away.abbr} @ {home.abbr}
          </h1>
        </div>
      )}
      <div className="live-board">
        <div className="live-board-team">
          <span className="hero-abbr">{away.abbr}</span>
          <span className="live-board-score">{st.showScore ? st.awayScore : "\u2013"}</span>
        </div>
        <div className="live-board-mid">
          {st.running ? (
            <span className="live-tag">
              <span className="live-dot" aria-hidden="true" />
              {st.statusText}
            </span>
          ) : (
            <span>{st.statusText}</span>
          )}
        </div>
        <div className="live-board-team live-board-home">
          <span className="hero-abbr">{home.abbr}</span>
          <span className="live-board-score">{st.showScore ? st.homeScore : "\u2013"}</span>
        </div>
      </div>
      {st.running && live && (possession || live.downDistance) && (
        <p className="live-situation">
          {possession && `Ballbesitz ${possession.abbr}`}
          {possession && live.downDistance && ", "}
          {live.downDistance}
          {live.redZone && ", Red Zone"}
        </p>
      )}
      {withPlays && (
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
      )}
      <section aria-label="Spielinfo">
        <h2>Spielinfo</h2>
        <dl className="game-facts">
          <div>
            <dt>Kickoff</dt>
            <dd>{formatKickoffZurich(game.kickoffUtc)} Uhr</dd>
          </div>
          <div>
            <dt>Tipp</dt>
            <dd>{tipText(tip, team, own)}</dd>
          </div>
          {final && (
            <div>
              <dt>Endstand</dt>
              <dd>
                {away.abbr} {st.awayScore} : {st.homeScore} {home.abbr}
                {shownResult && (
                  <span className={`res ${shownResult === "richtig" ? "res-ok" : shownResult === "ungewertet" ? "res-open" : "res-bad"}`}>
                    {" "}
                    {RESULT_TEXT[shownResult]}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </section>
      <GameFacts key={game.id} game={game} tip={tip} team={team} variant="card" now={now} own={own} />
      {tip && tip.level !== "nicht_erfasst" && (
        <a className="btn game-detail-link" href={tipsHref}>
          Zur Tippseite
        </a>
      )}
    </div>
  );
}
