import { useEffect, useMemo, useState } from "react";
import type { Game, Team } from "../core/schema";
import type { GameTip, StandingsFile, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich, groupBySlot } from "../core/time";
import { teamColor, visibleOn } from "./colors";
import { LoadError, currentRef, loadTipsData, navWeeks, parseWeekKey, type TipsData } from "./data";
import { GameHero, heroHeadlines, useNow, type HeroEmpty, type HeroNext, type HeroTarget } from "./GameHero";
import { LiveStatus, ScheduleList } from "./GamesView";
import { useLayoutValue } from "./layout";
import { periodText, useLiveScores, type LiveGame } from "./live";
import { LoadErrorNotice, PHASE_TEXT, PageHeader, Segmented, WeekStepper, fallbackTeam, fetchedFormat, weekLabel } from "./ui";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TipsData };

const LEVEL_TEXT: Record<GameTip["level"], string> = {
  klar: "klar",
  favorit: "Favorit",
  unklar: "unklar",
  offen: "offen",
  nicht_erfasst: "nicht erfasst",
};

// Häkchen "eingetragen" nur lokal. Gespeichert wird das getippte Team, damit eine spätere
// Änderung des Tipps erkannt wird. Jeder Storage Zugriff ist ausfalltolerant.
const NO_PICK = "ohne";

function storageKey(season: number, seasonType: number, week: number, gameId: string): string {
  return `nfl-dashboard:eingetragen:${season}-${seasonType}-${String(week).padStart(2, "0")}:${gameId}`;
}

/** Gespeichertes Team oder null. Alte Einträge ("1" oder "true") gelten als nicht eingetragen. */
function readEntered(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v === null || v === "1" || v === "true") return null;
    return v;
  } catch {
    return null;
  }
}

function writeEntered(key: string, value: string | null): void {
  try {
    if (value !== null) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Ohne Storage bleibt das Häkchen nur bis zum Neuladen erhalten.
  }
}

const pickKey = (t: GameTip): string => t.pickTeamId ?? NO_PICK;

type Filter = "offen" | "alle";
const FILTER_KEY = "nfl-dashboard:tipps-filter";

function readFilter(): Filter {
  try {
    return window.localStorage.getItem(FILTER_KEY) === "alle" ? "alle" : "offen";
  } catch {
    return "offen";
  }
}

function writeFilter(value: Filter): void {
  try {
    window.localStorage.setItem(FILTER_KEY, value);
  } catch {
    // Ohne Storage gilt die Auswahl nur bis zum Neuladen.
  }
}

const LEVEL_COLOR: Record<GameTip["level"], string> = {
  klar: "#3DDC97",
  favorit: "#8FB7FF",
  unklar: "#F5B83D",
  offen: "#AEB6C2",
  nicht_erfasst: "#AEB6C2",
};

export function TipsView({ arg = null }: { arg?: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    loadTipsData(parseWeekKey(arg))
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((err: unknown) => {
        if (!active) return;
        const message =
          err instanceof LoadError ? err.message : "Unerwarteter Fehler beim Laden der Daten.";
        setState({ kind: "error", message });
      });
    return () => {
      active = false;
    };
  }, [arg]);

  if (state.kind === "loading") return <p className="notice">Daten werden geladen …</p>;
  if (state.kind === "error") return <LoadErrorNotice message={state.message} />;
  const { data } = state;
  if (!data.tips || !data.week) return <NoTips data={data} />;
  return <TipsList key={`${data.ref.season}-${data.ref.seasonType}-${data.ref.week}`} data={data} tips={data.tips} />;
}

function TipsHeader({ data, updatedAt }: { data: TipsData; updatedAt?: string }) {
  const weeks = navWeeks(data);
  const meta = updatedAt
    ? `Saison ${data.ref.season} · Letzte Aktualisierung ${fetchedFormat.format(new Date(updatedAt))}`
    : `Saison ${data.ref.season}`;
  return (
    <PageHeader
      kicker={data.phase === "aktuell" ? "Tipps" : `Tipps · ${PHASE_TEXT[data.phase]}`}
      title={weekLabel(data.ref)}
      aside={weeks ? <WeekStepper view="tipps" weeks={weeks} value={data.ref} current={currentRef(data.current)} /> : undefined}
      meta={meta}
    />
  );
}

/** Woche ohne Tippdatei: aktuelle Woche wie bisher, kommende mit Hinweis und Spielplan. */
function NoTips({ data }: { data: TipsData }) {
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const text =
    data.phase === "kommend"
      ? "Tipps folgen, sobald Quoten verfügbar sind."
      : data.phase === "vergangen"
        ? "Für diese Woche gibt es keine App Tipps."
        : "Für diese Woche gibt es noch keine Tipps.";
  return (
    <>
      <TipsHeader data={data} />
      {data.phase === "aktuell" && (
        <div className="tiles">
          <StandingsBox standings={data.standings} maxDeviations={null} />
        </div>
      )}
      <p className="notice">{text}</p>
      {data.phase !== "aktuell" &&
        (data.week ? (
          <ScheduleList games={data.week.games} byeTeamIds={data.week.byeTeamIds} team={team} />
        ) : (
          <p className="notice">Für {weekLabel(data.ref)} liegt noch kein Spielplan vor.</p>
        ))}
    </>
  );
}

type TipResult = "richtig" | "falsch" | "unentschieden" | "offen" | null;

/** Ergebnis eines Tipps aus dem Spielstand der Wochendatei. null ohne Tipp. */
function tipResult(tip: GameTip, game: Game | undefined): TipResult {
  if (tip.pickTeamId === null || tip.level === "nicht_erfasst") return null;
  if (!game || game.status !== "final" || game.homeScore === null || game.awayScore === null) return "offen";
  if (game.homeScore === game.awayScore) return "unentschieden";
  const winner = game.homeScore > game.awayScore ? game.homeId : game.awayId;
  return winner === tip.pickTeamId ? "richtig" : "falsch";
}

type EntryStatus = "none" | "done" | "changed";

interface TipRow extends GameTip {
  id: string;
  game: Game | undefined;
  tiebreaker: boolean;
  result: TipResult;
}

function TipsList({ data, tips }: { data: TipsData; tips: TipsFile }) {
  const layout = useLayoutValue();
  const now = useNow();
  const readOnly = data.phase === "vergangen";
  const games = data.week?.games ?? null;
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const gameById = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const live = useLiveScores(readOnly ? null : data.ref, readOnly ? null : games);
  // Ab Kickoff gilt ein Spiel in der Anzeige als gesperrt, auch wenn der stündliche Tippjob es noch nicht
  // gesperrt hat. Nur Darstellung, die Datei bleibt unverändert.
  const rows: TipRow[] = useMemo(
    () => tips.tips.map((t) => ({
        ...t,
        locked: t.locked || Date.parse(t.kickoffUtc) <= now,
        id: t.gameId,
        game: gameById.get(t.gameId),
        tiebreaker: tips.tiebreakers.some((tb) => tb.gameId === t.gameId),
        result: tipResult(t, gameById.get(t.gameId)),
      })),
    [tips, gameById, now],
  );

  const keyFor = (gameId: string) => storageKey(tips.season, tips.seasonType, tips.week, gameId);
  const [entered, setEntered] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const t of tips.tips) {
      const v = readEntered(keyFor(t.gameId));
      if (v !== null) m.set(t.gameId, v);
    }
    return m;
  });
  const [filter, setFilter] = useState<Filter>(readFilter);
  // Im Filter Offen bleiben eben umgeschaltete Zeilen bis zum nächsten Filterwechsel oder Reload sichtbar
  const [sticky, setSticky] = useState<Set<string>>(() => new Set());

  const toggle = (row: TipRow) => {
    const value = entered.get(row.gameId) === pickKey(row) ? null : pickKey(row);
    setSticky((prev) => (prev.has(row.gameId) ? prev : new Set(prev).add(row.gameId)));
    writeEntered(keyFor(row.gameId), value);
    setEntered((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(row.gameId);
      else next.set(row.gameId, value);
      return next;
    });
  };

  const chooseFilter = (value: Filter) => {
    writeFilter(value);
    setFilter(value);
    setSticky(new Set());
  };

  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const statusOf = (r: TipRow): EntryStatus => {
    const v = entered.get(r.gameId);
    if (v === undefined) return "none";
    return v === pickKey(r) ? "done" : "changed";
  };
  const isPending = (r: TipRow) =>
    r.level !== "nicht_erfasst" && (statusOf(r) === "changed" || (statusOf(r) === "none" && !r.locked));
  const countable = rows.filter((r) => r.level !== "nicht_erfasst");
  const doneCount = countable.filter((r) => statusOf(r) === "done").length;
  const openCount = rows.filter(isPending).length;
  const visible =
    filter === "offen" && !readOnly ? rows.filter((r) => isPending(r) || sticky.has(r.gameId)) : rows;
  const slots = groupBySlot(visible);

  // Spielbereich: laufendes Spiel mit Live Score, sonst nächster Kickoff, der weder gesperrt noch vorbei ist
  const { hero, heroEmpty, heroLive, heroNext } = useMemo(() => {
    const byKickoff = (a: TipRow, b: TipRow) =>
      Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.gameId.localeCompare(b.gameId);
    const open = rows.filter((r) => !r.locked && r.level !== "nicht_erfasst" && Date.parse(r.kickoffUtc) > now);
    const next = open.filter((r) => r.game).sort(byKickoff)[0];
    const running = rows
      .filter((r) => r.game && live.games.get(r.gameId)?.state === "in")
      .sort((a, b) => Number(b.tiebreaker) - Number(a.tiebreaker) || byKickoff(a, b))[0];
    const pick = running ?? next;
    const target: HeroTarget | null =
      pick && pick.game
        ? { tip: pick, game: pick.game, tiebreaker: tips.tiebreakers.find((tb) => tb.gameId === pick.gameId) }
        : null;
    const nextInfo: HeroNext | null =
      running && next?.game
        ? { matchup: `${team(next.game.awayId).abbr} @ ${team(next.game.homeId).abbr}`, kickoffUtc: next.kickoffUtc }
        : null;
    return {
      hero: target,
      heroEmpty: (open.length > 0 ? "ohne_daten" : "gesperrt") as HeroEmpty,
      heroLive: running ? (live.games.get(running.gameId) ?? null) : null,
      heroNext: nextInfo,
    };
    // team hängt nur von teamById ab
  }, [rows, tips, now, live.games, teamById]);

  const header = <TipsHeader data={data} updatedAt={tips.updatedAt} />;
  const headlines = hero
    ? heroHeadlines(data.news?.items, [hero.game.awayId, hero.game.homeId], now, layout === "side" ? 1 : 2)
    : [];
  const heroEl = (
    <GameHero
      target={hero}
      empty={heroEmpty}
      team={team}
      injuries={data.injuries}
      now={now}
      live={heroLive}
      next={heroNext}
      headlines={headlines}
    />
  );
  const tiles = (
    <div className="tiles">
      <TiebreakerBox tips={tips} gameById={gameById} team={team} />
      {readOnly ? (
        <ResultBox rows={rows} />
      ) : (
        <StandingsBox standings={data.standings} maxDeviations={tips.maxDeviations} />
      )}
    </div>
  );
  const pct = countable.length > 0 ? Math.round((doneCount / countable.length) * 100) : 0;
  const list = (
    <section className="games-section" aria-label="Spiele der Woche">
      {rows.length === 0 ? (
        <p className="notice">Diese Woche sind keine Spiele angesetzt.</p>
      ) : (
        <>
          {!readOnly && <LiveStatus live={live} />}
          {!readOnly && <div className="list-controls">
            <Segmented
              label="Spiele filtern"
              value={filter}
              onChange={chooseFilter}
              options={[
                { value: "offen", label: `Offen ${openCount}` },
                { value: "alle", label: `Alle ${rows.length}` },
              ]}
            />
            {countable.length > 0 && (
              <div className={`progress${openCount > 0 ? " progress-open" : ""}`}>
                <div className="progress-bar" aria-hidden="true">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <span aria-live="polite">
                  {doneCount} von {countable.length} eingetragen
                  {openCount > 0 && <span className="sr-only">, {openCount} offen</span>}
                </span>
              </div>
            )}
          </div>}
          {visible.length === 0 && (
            <p className="notice">Keine offenen Spiele. Alle Tipps sind eingetragen oder gesperrt.</p>
          )}
          {slots.map((slot) => (
            <section key={slot.slotKey} className="slot">
              <h2>{slot.label}</h2>
              <ul className="tips">
                {slot.games.map((row) => (
                  <TipItem
                    key={row.gameId}
                    row={row}
                    team={team}
                    status={statusOf(row)}
                    onToggle={() => toggle(row)}
                    readOnly={readOnly}
                    live={live.games.get(row.gameId)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );

  if (readOnly) {
    return (
      <>
        {header}
        {tiles}
        {list}
      </>
    );
  }
  if (layout === "wide") {
    return (
      <div className="tips-split">
        <div className="pane pane-hero">{heroEl}</div>
        <div className="fold" aria-hidden="true" />
        <div className="pane pane-list">
          {header}
          {tiles}
          {list}
        </div>
      </div>
    );
  }
  return (
    <>
      {header}
      {heroEl}
      {tiles}
      {list}
    </>
  );
}

type Tiebreaker = TipsFile["tiebreakers"][number];

const SLOT_DAY: Record<Tiebreaker["slot"], string> = { thursday: "Do", monday: "Mo" };

function TiebreakerBox({
  tips,
  gameById,
  team,
}: {
  tips: TipsFile;
  gameById: Map<string, Game>;
  team: (id: string) => Team;
}) {
  if (tips.tiebreakers.length === 0) return null;
  return (
    <section className="box" aria-label="Tiebreaker">
      <h2>Tiebreaker</h2>
      <ul className="tb-list">
        {tips.tiebreakers.map((tb) => {
          const game = gameById.get(tb.gameId);
          const kickoff = tips.tips.find((t) => t.gameId === tb.gameId)?.kickoffUtc ?? game?.kickoffUtc;
          return (
            <li key={tb.gameId}>
              <span className="tb-day">{SLOT_DAY[tb.slot]}</span>
              <span className="tb-line">
                {game
                  ? `${team(game.awayId).abbr} ${tb.awayPoints}:${tb.homePoints} ${team(game.homeId).abbr}`
                  : `${tb.awayPoints}:${tb.homePoints}`}
              </span>
              <span className="box-meta">
                {kickoff ? `Kickoff ${formatKickoffZurich(kickoff)}` : ""}
                {tb.basis === "standard" ? " · Standardwert" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StandingsBox({ standings, maxDeviations }: { standings: StandingsFile; maxDeviations: number | null }) {
  const players = [...standings.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const mine = players.find((p) => p.id === standings.me);
  // Ziel ist immer Platz 1 (D028)
  const leader = players[0];
  const ahead = mine && leader && leader.points > mine.points ? leader : undefined;
  const gap = ahead && mine ? ahead.points - mine.points : 0;
  return (
    <section className="box" aria-label="Rangliste">
      <h2>Ziel Platz 1</h2>
      {mine && (
        <p className="box-big">{ahead ? <span aria-label={`minus ${gap}`}>{"\u2212"}{gap}</span> : "1."}</p>
      )}
      {mine && (
        <p className="box-meta">
          {ahead ? `${gap} ${gap === 1 ? "Punkt" : "Punkte"} hinter ${ahead.id} auf Platz 1` : "In Führung"}
        </p>
      )}
      {maxDeviations !== null && <p className="box-meta strong">Erlaubte Abweichungen diese Woche: {maxDeviations}</p>}
      <p className="box-meta">Rangliste nach Week {standings.asOfWeek}</p>
      <ol className="ranking">
        {players.map((p) => (
          <li key={p.id} className={p.id === standings.me ? "me" : undefined}>
            <span>{p.id}</span>
            <span className="pts">{p.points}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const RESULT_TEXT: Record<Exclude<TipResult, null>, string> = {
  richtig: "richtig",
  falsch: "falsch",
  unentschieden: "unentschieden",
  offen: "offen",
};

/** Ergebnis einer vergangenen Woche aus den gesperrten Tipps und den Endständen. */
function ResultBox({ rows }: { rows: TipRow[] }) {
  const tipped = rows.filter((r) => r.result !== null);
  const right = tipped.filter((r) => r.result === "richtig").length;
  const decided = tipped.filter((r) => r.result === "richtig" || r.result === "falsch").length;
  const open = tipped.filter((r) => r.result === "offen").length;
  return (
    <section className="box" aria-label="Ergebnis der Woche">
      <h2>Ergebnis</h2>
      <p className="box-big">
        {right} <span className="box-of">von {tipped.length}</span>
      </p>
      <p className="box-meta">
        {decided > 0 ? `Trefferquote ${Math.round((right / decided) * 100)} %` : "Noch kein Tipp entschieden"}
        {open > 0 && `, ${open} offen`}
      </p>
      <p className="box-meta">
        <a href="#bilanz">Zur Bilanz</a>
      </p>
    </section>
  );
}

function TipItem({
  row,
  team,
  status,
  onToggle,
  readOnly = false,
  live,
}: {
  row: TipRow;
  team: (id: string) => Team;
  status: EntryStatus;
  onToggle: () => void;
  readOnly?: boolean;
  live?: LiveGame;
}) {
  const notCaptured = row.level === "nicht_erfasst";
  const checked = status === "done";
  const { game } = row;
  const homeId = game?.homeId;
  const hasPick = row.level !== "offen" && !notCaptured && row.pickTeamId !== null;
  const pickId = hasPick ? row.pickTeamId! : (game?.awayId ?? null);
  const otherId = game ? (pickId === game.homeId ? game.awayId : game.homeId) : null;
  const pick = pickId ? team(pickId) : null;
  const other = otherId ? team(otherId) : null;
  const pending = !readOnly && !notCaptured && (status === "changed" || (status === "none" && !row.locked));

  const classes = ["tip", `level-${row.level}`];
  if (pending) classes.push("pending");
  if (checked) classes.push("done");
  if (status === "changed") classes.push("changed-entry");
  if (row.locked) classes.push("locked");

  const pct = hasPick && row.pickProb !== null ? Math.round(row.pickProb * 100) : null;
  const info = notCaptured ? "nicht erfasst" : pct !== null ? `${row.deviation ? "Abw. " : ""}${pct} %` : "keine Quote";
  const infoColor = row.deviation && pct !== null ? "#F5B83D" : LEVEL_COLOR[row.level];
  const dot = pick && hasPick ? visibleOn(teamColor(pick.color)) : "#3A414D";
  const liveText =
    live?.state === "in" && game ? ` · Live ${live.awayScore ?? 0}:${live.homeScore ?? 0} ${periodText(live)}` : "";
  const finalText =
    readOnly && game && game.status === "final" && game.awayScore !== null && game.homeScore !== null
      ? ` · ${game.awayScore}:${game.homeScore}`
      : "";
  const vs = other ? `${other.id === homeId ? "@" : "vs"} ${other.abbr}${liveText}${finalText}` : "";
  const label = hasPick && pick
    ? pick.abbr
    : game
      ? `Spiel ${team(game.awayId).abbr} @ ${team(game.homeId).abbr}`
      : `Spiel ${row.gameId}`;
  const hasFlags = row.tiebreaker || row.deviation || row.changedSinceFirst || (row.locked && !readOnly);

  return (
    <li className={classes.join(" ")} data-anchor={row.gameId}>
      <div className="tip-row">
        <span className="dot" style={{ background: dot }} aria-hidden="true" />
        <span className={hasPick ? "tip-pick" : "tip-pick nopick"} title={pick?.name}>
          {pick ? pick.abbr : `Spiel ${row.gameId}`}
        </span>
        <span className="tip-vs">{vs}</span>
        <span className="tip-info">
          <span style={{ color: infoColor }}>{info}</span>
          {!notCaptured && <span className={`level level-tag-${row.level}`}>{LEVEL_TEXT[row.level]}</span>}
        </span>
        {readOnly ? (
          row.result ? (
            <span className={`res-badge res-badge-${row.result}`}>{RESULT_TEXT[row.result]}</span>
          ) : (
            <span className="tick-spacer" aria-hidden="true" />
          )
        ) : notCaptured ? (
          <span className="tick-spacer" aria-hidden="true" />
        ) : (
          <label className="tick-wrap">
            <input
              className="tick"
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              aria-label={`${label} eingetragen`}
            />
          </label>
        )}
      </div>
      {hasFlags && (
        <div className="tip-flags">
          {row.tiebreaker && <span className="flag tb-flag">{readOnly ? "Tiebreaker" : "Resultat tippen"}</span>}
          {row.deviation && (
            <span className="flag flag-dev" title="Bewusste Abweichung vom Favoriten">
              <span aria-hidden="true">🎯</span> Abweichung
            </span>
          )}
          {row.changedSinceFirst && <span className="flag changed">geändert seit Grundtipp</span>}
          {row.locked && !readOnly && (
            <span className="flag" title="Kickoff vorbei, Tipp gesperrt">
              <span aria-hidden="true">🔒</span> gesperrt
            </span>
          )}
        </div>
      )}
      {status === "changed" && !readOnly && (
        <p className="entry-warning" role="alert">
          <span aria-hidden="true">⚠️</span> Tipp geändert, auf der Tippseite anpassen
        </p>
      )}
    </li>
  );
}
