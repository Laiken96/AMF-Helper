import { useEffect, useMemo, useState } from "react";
import type { Game, Team } from "../core/schema";
import type { StandingsFile, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich, groupBySlot } from "../core/time";
import {
  beforeAppStart,
  currentRef,
  loadStandingsOrNull,
  loadTipsData,
  loadWeekData,
  navWeeks,
  parseViewArg,
  parseWeekKey,
  prefetchNeighbours,
  setShownWeek,
  useKeptLoad,
  viewHash,
  type WeekData,
  type WeekRef,
} from "./data";
import { closeSheetHash, openSheetHash, replaceHash } from "./hash-nav";
import { useNow } from "./GameHero";
import { useLayoutValue } from "./layout";
import { GameView } from "./GameView";
import { gameState } from "./game-view";
import { GameSheet } from "./Sheet";
import { useChoices, usePlayer, useShownTips } from "./player";
import { useLiveScores, useLiveSummaries, type LiveGame, type LiveState } from "./live";
import { LiveCarousel, LiveTicker } from "./LiveTicker";
import { LoadErrorNotice, PageHeader, TeamBadge, WeekStepper, fallbackTeam, weekLabel, PageSplitMark } from "./ui";
import { clockFormat, formatCountdown, formatStand } from "./wording";

/** Reiter Spiele: Spielplan der gewählten Woche mit Liveticker für laufende Spiele. arg ist Woche und optional Spiel. */
export function GamesView({ arg }: { arg: string | null }) {
  // Aktuelle Woche ohne Woche im Hash (#spiele/401873037), damit die App nach dem Wochenwechsel mitzieht
  const { week: weekArg, game: gameArg } = parseViewArg(arg);
  const { data, error, pending } = useKeptLoad(`spiele:${weekArg ?? ""}`, () => loadGamesData(parseWeekKey(weekArg)));

  useEffect(() => {
    if (data) prefetchNeighbours(data, loadGamesData);
  }, [data]);
  const shownRef = data?.ref;
  useEffect(() => {
    setShownWeek(shownRef ?? null);
  }, [shownRef]);

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

type GamesData = WeekData & { tips: TipsFile | null; standings: StandingsFile | null };

/**
 * Wochendaten mit Tippliste für die Spielinfo. Scheitert das Laden der Tippdaten, bleibt der Spielplan, die
 * Rangliste wird dann einzeln geladen. Ohne Rangliste ist keine eigene Wahl möglich (kein Spieler bekannt).
 */
function loadGamesData(ref: WeekRef | null = null): Promise<GamesData> {
  return loadTipsData(ref).catch(async () => {
    const [week, standings] = await Promise.all([loadWeekData(ref), loadStandingsOrNull()]);
    return { ...week, tips: null, standings };
  });
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
  const player = usePlayer(data.standings);
  const { choices, setChoice } = useChoices(player.player, ref);
  const shownTips = useShownTips(data.tips, week?.games, data.standings, phase, player.player, choices);
  // Ohne Rangliste oder Spieler gäbe es nur den Schlüssel "ohne": dann keine eigene Wahl
  const canChoose = phase !== "vergangen" && data.standings !== null && player.player !== null;
  const current = currentRef(data.current);

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
  const hashFor = (id: string | null) => viewHash("spiele", ref, current, id);
  const baseHash = hashFor(null);
  // Auswahl innerhalb der Woche ersetzt den Verlaufseintrag (wide, Karussell). Nur ein Blatt legt einen Eintrag an,
  // Schliessen verlässt ihn wieder, damit Zurück das Blatt nicht erneut öffnet
  const select = (id: string) => {
    const opensSheet = !wide && !runningIds.includes(id);
    if (opensSheet) openSheetHash(hashFor(id));
    else replaceHash(hashFor(id));
  };
  const closeSheet = () => closeSheetHash(baseHash);

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
        tipsHref={viewHash("tipps", ref, current, g.id)}
      />
    ) : null;
  };
  const viewFor = (g: Game) => (
    <GameView
      game={g}
      live={live.games.get(g.id)}
      tip={tipOf(g.id)}
      tiebreaker={shownTips?.tiebreakers.find((tb) => tb.gameId === g.id)}
      own={ownOf(g.id)}
      team={team}
      now={now}
      tipsHref={viewHash("tipps", ref, current, g.id)}
      onChoice={canChoose ? setChoice : null}
      tipsPending={!data.tips && phase === "kommend"}
    />
  );
  const matchupLabel = (g: Game) => {
    const lg = live.games.get(g.id);
    const a = team(g.awayId).abbr;
    const h = team(g.homeId).abbr;
    return lg && lg.awayScore !== null && lg.homeScore !== null ? `${a} ${lg.awayScore} zu ${lg.homeScore} ${h}` : `${a} gegen ${h}`;
  };
  // Kommende Woche: kein "Gerade läuft kein Spiel", in der aktuellen Woche kann eines laufen
  const nextHint =
    running.length === 0 && nextGame && phase !== "vergangen" ? (
      <p className="notice tk-next">
        {phase === "aktuell" ? "Gerade läuft kein Spiel. Nächstes Spiel" : "Nächstes Spiel dieser Woche"}{" "}
        {team(nextGame.awayId).abbr} @ {team(nextGame.homeId).abbr},{" "}
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
        <PageSplitMark />
        <div className="pane pane-detail">
          {shownGame && runningIds.includes(shownGame.id) && live.games.get(shownGame.id) ? (
            tickerFor(shownGame)
          ) : shownGame ? (
            viewFor(shownGame)
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
            // Wischen ersetzt den Eintrag, sonst sammelt jede Karte einen Verlaufseintrag an
            if (selectedRunning && selectedRunning !== id) replaceHash(baseHash);
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
        <GameSheet title={`${team(sheetGame.awayId).abbr} @ ${team(sheetGame.homeId).abbr}`} onClose={closeSheet}>
          {viewFor(sheetGame)}
        </GameSheet>
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
