import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Game, Team, WeekFile } from "../core/schema";
import { tipResult, type TipResult } from "../core/review";
import { standingsAppliesTo } from "../core/standings";
import { tiebreakerGames } from "../core/tips";
import type { GameTip, StandingsFile, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich, groupBySlot } from "../core/time";
import { teamColor, visibleOn } from "./colors";
import {
  beforeAppStart,
  currentRef,
  loadTipsData,
  navWeeks,
  parseWeekKey,
  prefetchNeighbours,
  useKeptLoad,
  weekKey,
  type TipsData,
} from "./data";
import { GameHero, heroHeadlines, useNow, type HeroEmpty, type HeroNext, type HeroTarget, type HeroVariant } from "./GameHero";
import { LiveStatus } from "./GamesView";
import { useLayoutValue } from "./layout";
import { periodText, useLiveScores, type LiveGame } from "./live";
import { LoadErrorNotice, PageHeader, Segmented, Spoken, WeekStepper, fallbackTeam, weekLabel } from "./ui";
import { SLOT_LONG, SLOT_SHORT, TIME_ZONE_TEXT, deviationReason, formatStand, scoreAria, scoreText, spreadText } from "./wording";

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
  // #tipps/2026-2-09/401873037: Woche und gewähltes Spiel. Nur die Woche löst ein Laden aus.
  const [weekArg = null, gameArg = null] = arg ? arg.split("/") : [];
  const { data, error, pending } = useKeptLoad(`tipps:${weekArg ?? ""}`, () => loadTipsData(parseWeekKey(weekArg)));

  // Nachbarwochen im Hintergrund vorladen, damit der nächste Wechsel aus dem Cache kommt
  useEffect(() => {
    if (data) prefetchNeighbours(data, loadTipsData);
  }, [data]);

  if (error) return <LoadErrorNotice message={error} />;
  if (!data) return <p className="notice">Daten werden geladen …</p>;
  if (!data.week) {
    return (
      <>
        <TipsHeader data={data} pending={pending} />
        <p className="notice">
          {beforeAppStart(data.index, data.ref)
            ? `${weekLabel(data.ref)} liegt vor dem App Start, keine Daten.`
            : `Für ${weekLabel(data.ref)} liegt noch kein Spielplan vor.`}
        </p>
      </>
    );
  }
  const mode: Mode = !data.tips ? "folgt" : data.phase === "vergangen" ? "vergangen" : "offen";
  const tips = data.tips ?? placeholderTips(data.week);
  return (
    <TipsList
      key={`${data.ref.season}-${data.ref.seasonType}-${data.ref.week}`}
      data={data}
      week={data.week}
      tips={tips}
      mode={mode}
      pending={pending}
      selectedId={gameArg}
    />
  );
}

/** offen: Tipps mit Häkchen. vergangen: nur lesen mit Ergebnis. folgt: kommende Woche ohne Tippdatei. */
type Mode = "offen" | "vergangen" | "folgt";

/** Tippliste ohne Quoten für eine Woche ohne Tippdatei: gleiche Zeilen, Status offen, Tiebreaker markiert. */
function placeholderTips(week: WeekFile): TipsFile {
  return {
    schemaVersion: 1,
    season: week.season,
    seasonType: week.seasonType,
    week: week.week,
    updatedAt: week.fetchedAt,
    maxDeviations: 0,
    tips: week.games.map((g) => ({
      gameId: g.id,
      kickoffUtc: g.kickoffUtc,
      odds: null,
      pHome: null,
      pickTeamId: null,
      pickProb: null,
      level: "offen",
      deviation: false,
      firstPickTeamId: null,
      changedSinceFirst: false,
      locked: false,
      lockedAt: null,
    })),
    tiebreakers: tiebreakerGames(week.games).map(({ slot, game }) => ({
      gameId: game.id,
      slot,
      homePoints: 0,
      awayPoints: 0,
      basis: "standard" as const,
    })),
  };
}

const KICKER: Record<TipsData["phase"], string> = { aktuell: "Tipps · Aktuell", vergangen: "Tipps · Vorbei", kommend: "Tipps · Nächste" };

function TipsHeader({ data, updatedAt, pending }: { data: TipsData; updatedAt?: string; pending: boolean }) {
  const weeks = navWeeks(data);
  const meta = updatedAt
    ? `Saison ${data.ref.season} · ${formatStand(updatedAt)} · ${TIME_ZONE_TEXT}`
    : `Saison ${data.ref.season} · ${TIME_ZONE_TEXT}`;
  return (
    <PageHeader
      kicker={weeks ? KICKER[data.phase] : "Tipps"}
      title={weekLabel(data.ref)}
      aside={
        weeks ? (
          <WeekStepper view="tipps" weeks={weeks} value={data.ref} current={currentRef(data.current)} pending={pending} />
        ) : undefined
      }
      meta={meta}
    />
  );
}

type EntryStatus = "none" | "done" | "changed";

interface TipRow extends GameTip {
  id: string;
  game: Game | undefined;
  tiebreaker: boolean;
  result: TipResult;
}

function TipsList({
  data,
  week,
  tips,
  mode,
  pending,
  selectedId,
}: {
  data: TipsData;
  week: WeekFile;
  tips: TipsFile;
  mode: Mode;
  pending: boolean;
  /** Gewähltes Spiel aus dem Hash, null heisst Standardspiel. */
  selectedId: string | null;
}) {
  const layout = useLayoutValue();
  const now = useNow();
  const readOnly = mode === "vergangen";
  // Ohne Häkchen und Filter: vergangene Wochen und Wochen ohne Tippdatei
  const passive = mode !== "offen";
  const games = week.games;
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const gameById = useMemo(() => new Map((games ?? []).map((g) => [g.id, g])), [games]);
  const live = useLiveScores(readOnly ? null : data.ref, readOnly ? null : games);
  const reviewHref = `#bilanz/${weekKey(data.ref)}`;
  // Ab Kickoff gilt ein Spiel in der Anzeige als gesperrt, auch wenn der stündliche Tippjob es noch nicht
  // gesperrt hat. Nur Darstellung, die Datei bleibt unverändert.
  const rows: TipRow[] = useMemo(
    () => tips.tips.map((t) => ({
        ...t,
        locked: mode === "folgt" ? false : t.locked || Date.parse(t.kickoffUtc) <= now,
        id: t.gameId,
        game: gameById.get(t.gameId),
        tiebreaker: tips.tiebreakers.some((tb) => tb.gameId === t.gameId),
        result: tipResult(t, gameById.get(t.gameId), t.kickoffUtc, new Date(now).toISOString()),
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
    !passive && r.level !== "nicht_erfasst" && (statusOf(r) === "changed" || (statusOf(r) === "none" && !r.locked));
  const countable = rows.filter((r) => r.level !== "nicht_erfasst");
  const notCapturedCount = rows.length - countable.length;
  const doneCount = countable.filter((r) => statusOf(r) === "done").length;
  const openCount = rows.filter(isPending).length;
  const visible =
    filter === "offen" && !passive ? rows.filter((r) => isPending(r) || sticky.has(r.gameId)) : rows;
  const slots = groupBySlot(visible);

  // Spielbereich: laufendes Spiel mit Live Score, sonst nächster Kickoff, der weder gesperrt noch vorbei ist
  const { hero, heroEmpty, heroLive, heroNext } = useMemo(() => {
    const byKickoff = (a: TipRow, b: TipRow) =>
      Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) || a.gameId.localeCompare(b.gameId);
    const targetOf = (r: TipRow | undefined): HeroTarget | null =>
      r && r.game ? { tip: r, game: r.game, tiebreaker: tips.tiebreakers.find((tb) => tb.gameId === r.gameId) } : null;
    if (mode !== "offen") {
      const withGame = rows.filter((r) => r.game).sort(byKickoff);
      // folgt: erstes Spiel, das noch kommt. vergangen: letztes Spiel mit Tipp, sonst das letzte Spiel.
      const pickRow =
        mode === "folgt"
          ? (withGame.find((r) => Date.parse(r.kickoffUtc) > now) ?? withGame[0])
          : ([...withGame].reverse().find((r) => r.result !== null) ?? withGame[withGame.length - 1]);
      return { hero: targetOf(pickRow), heroEmpty: "ohne_daten" as HeroEmpty, heroLive: null, heroNext: null };
    }
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
  }, [rows, tips, now, live.games, teamById, mode]);

  const header = <TipsHeader data={data} updatedAt={data.tips ? tips.updatedAt : undefined} pending={pending} />;
  // ---------- Auswahl eines Spiels (List Detail, D037) ----------
  const baseHash = `#tipps/${weekKey(data.ref)}`;
  const defaultId = hero?.game.id ?? null;
  const selectedRow = selectedId ? rows.find((r) => r.gameId === selectedId && r.game) : undefined;
  const shownRow = selectedRow ?? (defaultId ? rows.find((r) => r.gameId === defaultId) : undefined);
  const select = (id: string | null) => {
    const target = id ? `${baseHash}/${id}` : baseHash;
    if (window.location.hash !== target) window.location.hash = target;
  };
  const wide = layout === "wide";
  // Reihenfolge der Liste mit aktivem Filter. Liegt das gezeigte Spiel ausserhalb, zählt seine Position in Alle.
  const allOrder = groupBySlot(rows).flatMap((sl) => sl.games).filter((r) => r.game);
  const visibleIds = new Set(visible.map((r) => r.gameId));
  const shownIdx = shownRow ? allOrder.findIndex((r) => r.gameId === shownRow.gameId) : -1;
  const prevRow = shownIdx >= 0 ? [...allOrder.slice(0, shownIdx)].reverse().find((r) => visibleIds.has(r.gameId)) : undefined;
  const nextRow = shownIdx >= 0 ? allOrder.slice(shownIdx + 1).find((r) => visibleIds.has(r.gameId)) : undefined;
  const visibleOrder = allOrder.filter((r) => visibleIds.has(r.gameId));
  const posInList = shownRow ? visibleOrder.findIndex((r) => r.gameId === shownRow.gameId) : -1;
  const matchupOf = (r: TipRow) => (r.game ? `${team(r.game.awayId).abbr} @ ${team(r.game.homeId).abbr}` : `Spiel ${r.gameId}`);
  const isDefault = !selectedRow || selectedRow.gameId === defaultId;
  const homeLabel = mode === "offen" ? "Zum nächsten Tippschluss" : mode === "folgt" ? "Zum ersten Spiel" : "Zum letzten Spiel";

  // Rückstand auf Platz 1 für die Begründung einer Abweichung (Ziel Platz 1, D028). Eine Rangliste aus einer
  // anderen Saison gilt nicht (D051), dann ohne Rückstand in der Begründung.
  const gap = useMemo(() => {
    if (!standingsAppliesTo(data.standings, data.ref.season)) return null;
    const players = data.standings.players;
    const mine = players.find((p) => p.id === data.standings.me);
    if (!mine || players.length === 0) return null;
    return Math.max(0, Math.max(...players.map((p) => p.points)) - mine.points);
  }, [data.standings, data.ref.season]);
  const deviationNoteOf = (tip: GameTip | undefined, game: Game | undefined): string | null => {
    if (!tip || !game || !tip.deviation || !tip.pickTeamId) return null;
    const pick = team(tip.pickTeamId);
    const otherId = tip.pickTeamId === game.homeId ? game.awayId : game.homeId;
    const baseId = tip.firstPickTeamId && tip.firstPickTeamId !== tip.pickTeamId ? tip.firstPickTeamId : otherId;
    const baseProb =
      tip.pickProb === null ? null : baseId === tip.pickTeamId ? tip.pickProb : 1 - tip.pickProb;
    return deviationReason({
      pickAbbr: pick.abbr,
      pickProb: tip.pickProb,
      baseAbbr: team(baseId).abbr,
      baseProb,
      spread: spreadText(tip.odds, team(game.homeId).abbr, team(game.awayId).abbr),
      maxDeviations: tips.maxDeviations,
      gap,
    });
  };

  const heroProps = (row: TipRow | undefined, isSelected: boolean) => {
    if (!row || !row.game || !isSelected) {
      return {
        target: hero,
        live: heroLive,
        next: heroNext,
        variant: (mode === "vergangen" ? "final" : mode === "folgt" ? "folgt" : "offen") as HeroVariant,
        result: (hero ? rows.find((r) => r.gameId === hero.game.id)?.result : null) ?? null,
        game: hero?.game,
      };
    }
    const lv = live.games.get(row.gameId);
    const running = lv?.state === "in";
    const variant: HeroVariant =
      mode === "folgt"
        ? "folgt"
        : mode === "vergangen" || (!running && (row.locked || row.game.status === "final"))
          ? "final"
          : "offen";
    return {
      target: { tip: row, game: row.game, tiebreaker: tips.tiebreakers.find((tb) => tb.gameId === row.gameId) } as HeroTarget,
      live: running ? (lv ?? null) : null,
      next: running ? heroNext : null,
      variant,
      result: row.result,
      game: row.game,
    };
  };

  const renderHero = (inSheet: boolean) => {
    const useSelection = inSheet || wide;
    const hp = heroProps(useSelection ? shownRow : undefined, useSelection && Boolean(selectedRow));
    const headlines =
      hp.game && !readOnly
        ? heroHeadlines(data.news?.items, [hp.game.awayId, hp.game.homeId], now, layout === "side" ? 1 : 2)
        : [];
    const nav =
      useSelection && shownRow ? (
        <div className="hero-nav" role="group" aria-label="Spiel wählen">
          <button
            type="button"
            className="hero-nav-arrow"
            disabled={!prevRow}
            aria-label={prevRow ? `Vorheriges Spiel, ${matchupOf(prevRow)}` : "Kein vorheriges Spiel"}
            onClick={() => prevRow && select(prevRow.gameId)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="hero-nav-pos">
            {posInList >= 0 ? (
              <>
                <span aria-hidden="true">
                  {posInList + 1}/{visibleOrder.length}
                </span>
                <span className="sr-only">
                  Spiel {posInList + 1} von {visibleOrder.length}
                </span>
              </>
            ) : (
              "ausserhalb Filter"
            )}
          </span>
          <button
            type="button"
            className="hero-nav-arrow"
            disabled={!nextRow}
            aria-label={nextRow ? `Nächstes Spiel, ${matchupOf(nextRow)}` : "Kein nächstes Spiel"}
            onClick={() => nextRow && select(nextRow.gameId)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            type="button"
            className="hero-nav-home"
            style={isDefault || !defaultId ? { visibility: "hidden" } : undefined}
            aria-hidden={isDefault || !defaultId ? true : undefined}
            tabIndex={isDefault || !defaultId ? -1 : undefined}
            onClick={() => select(inSheet ? defaultId : null)}
          >
            {homeLabel}
          </button>
        </div>
      ) : null;
    return (
      <GameHero
        target={hp.target}
        empty={heroEmpty}
        team={team}
        injuries={data.injuries}
        now={now}
        live={hp.live}
        next={hp.next}
        headlines={headlines}
        variant={hp.variant}
        result={hp.result}
        reviewHref={reviewHref}
        nav={nav}
        deviationNote={hp.target && hp.variant !== "folgt" ? deviationNoteOf(hp.target.tip, hp.target.game) : null}
      />
    );
  };
  const heroEl = renderHero(false);

  // wide: gewählte Zeile in der Liste sichtbar halten
  const shownId = shownRow?.gameId ?? null;
  useEffect(() => {
    if (!wide || !shownId || !selectedId) return;
    document.querySelector(`[data-anchor="${CSS.escape(shownId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [wide, shownId, selectedId]);

  const tiles = (
    <div className="tiles">
      <TiebreakerBox tips={tips} gameById={gameById} team={team} open={mode === "folgt"} />
      <StandingsBox
        standings={data.standings}
        season={data.ref.season}
        maxDeviations={mode === "folgt" ? null : tips.maxDeviations}
      />
    </div>
  );
  const pct = countable.length > 0 ? Math.round((doneCount / countable.length) * 100) : 0;
  const progress = useMemo(() => {
    if (mode === "folgt") return { pct: 0, text: "Tipps folgen" };
    if (mode === "vergangen") {
      const tipped = rows.filter((r) => r.result !== null && r.result !== "ungewertet").length;
      const right = rows.filter((r) => r.result === "richtig").length;
      return { pct: tipped > 0 ? Math.round((right / tipped) * 100) : 0, text: `${right} von ${tipped} richtig` };
    }
    return { pct, text: `${doneCount} von ${countable.length} eingetragen` };
  }, [mode, rows, pct, doneCount, countable.length]);
  const list = (
    <section className="games-section" aria-label="Spiele der Woche">
      {rows.length === 0 ? (
        <p className="notice">Diese Woche sind keine Spiele angesetzt.</p>
      ) : (
        <>
          {!readOnly && <LiveStatus live={live} />}
          <div className="list-controls">
            <Segmented
              label="Spiele filtern"
              value={passive ? "alle" : filter}
              onChange={chooseFilter}
              disabled={passive}
              options={[
                { value: "offen", label: `Offen ${openCount}` },
                { value: "alle", label: `Alle ${rows.length}` },
              ]}
            />
            <div className={`progress${openCount > 0 ? " progress-open" : ""}`}>
              <div className="progress-bar" aria-hidden="true">
                <div style={{ width: `${progress.pct}%` }} />
              </div>
              <span aria-live="polite">
                {progress.text}
                {openCount > 0 && <span className="sr-only">, {openCount} offen</span>}
              </span>
            </div>
          </div>
          {notCapturedCount > 0 && (
            <p className="notice notice-pending">
              {notCapturedCount === rows.length
                ? "Für diese Woche gibt es keine App Tipps, die App lief bei Kickoff noch nicht."
                : `${notCapturedCount} ${notCapturedCount === 1 ? "Spiel hat" : "Spiele haben"} keinen App Tipp, die App lief bei Kickoff noch nicht.`}
            </p>
          )}
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
                    upcoming={mode === "folgt"}
                    live={live.games.get(row.gameId)}
                    selected={wide && row.gameId === shownId}
                    previous={row.changedSinceFirst && row.firstPickTeamId ? team(row.firstPickTeamId).abbr : null}
                    onSelect={() => select(row.gameId)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );

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
      {selectedRow && (
        <GameSheet title={matchupOf(selectedRow)} onClose={() => select(null)}>
          {renderHero(true)}
        </GameSheet>
      )}
    </>
  );
}

/** Spielbereich als Blatt von unten (compact, side, medium). Hintergrund gesperrt, Fokus bleibt im Blatt. */
function GameSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    root.classList.add("sheet-open");
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const items = [...sheetRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter(
        (el) => el.tabIndex >= 0 && el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.classList.remove("sheet-open");
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={`Spiel ${title}`}>
        <div className="sheet-head">
          <span className="sheet-grip" aria-hidden="true" />
          <button ref={closeRef} type="button" className="btn btn-close" onClick={onClose}>
            Schliessen
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function TiebreakerBox({
  tips,
  gameById,
  team,
  open = false,
}: {
  tips: TipsFile;
  gameById: Map<string, Game>;
  team: (id: string) => Team;
  /** Woche ohne Tippdatei: Spiele markiert, Resultat offen. */
  open?: boolean;
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
              <abbr className="tb-day" title={SLOT_LONG[tb.slot]}>
                {SLOT_SHORT[tb.slot]}
              </abbr>
              <span className="tb-line">
                {game && `${team(game.awayId).abbr} `}
                {open ? (
                  game ? "@" : "Resultat offen"
                ) : (
                  <Spoken shown={scoreText(tb.awayPoints, tb.homePoints)} spoken={scoreAria(tb.awayPoints, tb.homePoints)} />
                )}
                {game && ` ${team(game.homeId).abbr}`}
              </span>
              <span className="box-meta">
                {kickoff ? `Kickoff ${formatKickoffZurich(kickoff)}` : ""}
                {open ? " · Resultat offen" : tb.basis === "standard" ? " · Standardwert" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StandingsBox({
  standings,
  season,
  maxDeviations,
}: {
  standings: StandingsFile;
  season: number;
  maxDeviations: number | null;
}) {
  const players = [...standings.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const mine = players.find((p) => p.id === standings.me);
  // Ziel ist immer Platz 1 (D028). Rangliste aus einer anderen Saison: kein Rückstand (D051).
  const applies = standingsAppliesTo(standings, season);
  const leader = players[0];
  const ahead = applies && mine && leader && leader.points > mine.points ? leader : undefined;
  const gap = ahead && mine ? ahead.points - mine.points : 0;
  return (
    <section className="box" aria-label="Rangliste">
      <h2>Ziel Platz 1</h2>
      {mine && applies && (
        <p className="box-big">
          {ahead ? (
            <Spoken shown={`\u2212${gap}`} spoken={`minus ${gap}`} />
          ) : (
            "1."
          )}
        </p>
      )}
      {mine && applies && (
        <p className="box-meta">
          {ahead ? `${gap} ${gap === 1 ? "Punkt" : "Punkte"} hinter ${ahead.id} auf Platz 1` : "In Führung"}
        </p>
      )}
      {!applies && <p className="box-meta">Neue Saison, Rückstand erst nach der ersten Meldung</p>}
      <p className="box-meta strong">Erlaubte Abweichungen diese Woche: {maxDeviations ?? "offen"}</p>
      <p className="box-meta">
        Rangliste nach Week {standings.asOfWeek}
        {!applies && standings.season !== undefined ? ` der Saison ${standings.season}` : ""}
      </p>
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
  ungewertet: "ungewertet",
};

function TipItem({
  row,
  team,
  status,
  onToggle,
  readOnly = false,
  upcoming = false,
  live,
  selected = false,
  onSelect,
  previous = null,
}: {
  row: TipRow;
  team: (id: string) => Team;
  status: EntryStatus;
  onToggle: () => void;
  readOnly?: boolean;
  /** Woche ohne Tippdatei: Status offen statt Prozent, kein Häkchen. */
  upcoming?: boolean;
  live?: LiveGame;
  /** Zeile ist im Spielbereich gezeigt (wide). */
  selected?: boolean;
  onSelect?: () => void;
  /** Kürzel des Grundtipps, wenn der Tipp seither geändert hat. */
  previous?: string | null;
}) {
  const notCaptured = row.level === "nicht_erfasst";
  const checked = status === "done";
  const { game } = row;
  const hasPick = row.level !== "offen" && !notCaptured && row.pickTeamId !== null;
  const pick = hasPick ? team(row.pickTeamId!) : null;
  const away = game ? team(game.awayId) : null;
  const home = game ? team(game.homeId) : null;
  const pending = !readOnly && !upcoming && !notCaptured && (status === "changed" || (status === "none" && !row.locked));
  // Beendetes Spiel: Endstand und Ergebnis direkt in der Zeile, auch in der laufenden Woche
  const finished = Boolean(game && game.status === "final" && game.awayScore !== null && game.homeScore !== null);
  const decided = row.result === "richtig" || row.result === "falsch" || row.result === "unentschieden";
  const showResult = finished && (readOnly || decided);

  const classes = ["tip", `level-${row.level}`];
  if (pending) classes.push("pending");
  if (checked) classes.push("done");
  if (status === "changed") classes.push("changed-entry");
  if (row.locked) classes.push("locked");
  if (selected) classes.push("selected");
  if (finished) classes.push("finished");

  const pct = hasPick && row.pickProb !== null ? Math.round(row.pickProb * 100) : null;
  const info = upcoming
    ? "Quote folgt"
    : notCaptured
      ? ""
      : pct !== null
        ? `${row.deviation ? "Abw. " : ""}${pct} %`
        : "keine Quote";
  const infoAria = upcoming
    ? "Quote folgt"
    : notCaptured
      ? "kein App Tipp"
      : pct !== null
        ? `${row.deviation ? "Abweichung, " : ""}Siegwahrscheinlichkeit ${pct} Prozent`
        : "keine Quote";
  const infoColor = row.deviation && pct !== null ? "#F5B83D" : LEVEL_COLOR[row.level];
  const dot = pick ? visibleOn(teamColor(pick.color)) : "#3A414D";
  const liveText = live?.state === "in" && game ? `Live ${live.awayScore ?? 0} : ${live.homeScore ?? 0} ${periodText(live)}` : "";
  const finalText = finished && game ? scoreText(game.awayScore!, game.homeScore!) : "";
  const matchup = away && home ? `${away.abbr} @ ${home.abbr}` : `Spiel ${row.gameId}`;
  const label = pick ? pick.abbr : `Spiel ${matchup}`;
  const hasFlags = row.tiebreaker || row.deviation || previous !== null || (row.locked && !readOnly && !finished);
  const teamCls = (t: Team | null) => (pick && t ? (t.id === pick.id ? "tip-team tip-team-pick" : "tip-team tip-team-other") : "tip-team");
  const ariaScore = finished && game ? `, Endstand ${game.awayScore} zu ${game.homeScore}` : liveText ? `, ${liveText}` : "";

  return (
    <li className={classes.join(" ")} data-anchor={row.gameId}>
      <div className="tip-row">
        <button
          type="button"
          className="tip-select"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          aria-label={`${matchup}, Tipp ${pick ? pick.abbr : notCaptured ? "keiner" : "offen"}, ${infoAria}${ariaScore}${showResult && row.result ? `, ${RESULT_TEXT[row.result]}` : ""}. Im Spielbereich zeigen`}
        >
          <span className="dot" style={{ background: dot }} aria-hidden="true" />
          {away && home ? (
            <span className="tip-teams" aria-hidden="true">
              <span className={teamCls(away)} title={away.name}>
                {away.abbr}
              </span>
              <span className="tip-at">@</span>
              <span className={teamCls(home)} title={home.name}>
                {home.abbr}
              </span>
            </span>
          ) : (
            <span className="tip-pick nopick">Spiel {row.gameId}</span>
          )}
          <span className="tip-vs" aria-hidden="true">
            {finalText ? <span className="tip-final">{finalText}</span> : liveText}
          </span>
          {info && (
            <span className="tip-info" aria-hidden="true">
              <span style={{ color: infoColor }}>{info}</span>
              <span className={`level level-tag-${row.level}`}>{LEVEL_TEXT[row.level]}</span>
            </span>
          )}
        </button>
        {showResult && row.result ? (
          <span className={`res-badge res-badge-${row.result}`}>{RESULT_TEXT[row.result]}</span>
        ) : upcoming || readOnly || notCaptured ? (
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
          {row.tiebreaker && <span className="flag tb-flag">{readOnly || finished ? "Tiebreaker" : "Resultat tippen"}</span>}
          {row.deviation && (
            <span className="flag flag-dev" title="Bewusste Abweichung vom Favoriten">
              <span aria-hidden="true">🎯</span> Abweichung
            </span>
          )}
          {previous !== null && (
            <span className="flag changed">
              <span className="sr-only">Grundtipp </span>vorher: {previous}
            </span>
          )}
          {row.locked && !readOnly && !finished && (
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
