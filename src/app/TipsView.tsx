import { useEffect, useMemo, useRef, useState } from "react";
import type { Game, Team, WeekFile } from "../core/schema";
import { tipResult, type TipResult } from "../core/review";
import { deviationCandidates } from "../core/deviation";
import { tiebreakerGames } from "../core/tips";
import { TIPS_SCHEMA_VERSION, type GameTip, type TipsFile } from "../core/tips-schema";
import { formatKickoffZurich, groupBySlot } from "../core/time";
import {
  beforeAppStart,
  currentRef,
  loadTipsData,
  navWeeks,
  parseViewArg,
  parseWeekKey,
  prefetchNeighbours,
  setShownWeek,
  useFactsData,
  useKeptLoad,
  viewHash,
  weekKey,
  type TipsData,
} from "./data";
import { closeSheetHash, openSheetHash, replaceHash } from "./hash-nav";
import { GameSheet } from "./Sheet";
import {
  GameHero,
  heroHeadlines,
  useNow,
  type HeroChoice,
  type HeroEmpty,
  type HeroNext,
  type HeroTarget,
  type HeroVariant,
} from "./GameHero";
import { LiveStatus } from "./GamesView";
import { RESULT_BADGE, entryPending, levelLabel, outsiderChoice, withLiveFinal, type EntryStatus } from "./game-view";
import { useLayoutValue } from "./layout";
import { periodText, useLiveScores, type LiveGame } from "./live";
import {
  readEntered,
  useChoices,
  usePlayer,
  useShownTips,
  writeEntered,
  type ChoiceState,
} from "./player";
import { ownSeasonTally, useSeasonReviews, type WeekTally } from "./season-data";
import { LoadErrorNotice, PageHeader, Segmented, Spoken, TeamLogo, WeekStepper, fallbackTeam, weekLabel, PageSplitMark } from "./ui";
import { SLOT_LONG, SLOT_SHORT, TIME_ZONE_TEXT, formatStand, scoreAria, scoreText } from "./wording";

// Häkchen "eingetragen" nur lokal und pro Kürzel des Hauptnutzers (player.ts). Gespeichert wird das getippte Team, damit eine
// spätere Änderung des Tipps erkannt wird. Jeder Storage Zugriff ist ausfalltolerant.
const NO_PICK = "ohne";

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

// Farben über CSS Variablen, damit Hell und Dunkel aus demselben Set kommen (theme-light.css)
const LEVEL_COLOR: Record<GameTip["level"], string> = {
  klar: "var(--klar)",
  favorit: "var(--favorit)",
  unklar: "var(--unklar)",
  offen: "var(--text-3)",
  nicht_erfasst: "var(--text-3)",
};

export function TipsView({ arg = null }: { arg?: string | null }) {
  // #tipps/2026-2-09/401873037: Woche und gewähltes Spiel, für die aktuelle Woche ohne Woche (#tipps/401873037).
  // Nur die Woche löst ein Laden aus.
  const { week: weekArg, game: gameArg } = parseViewArg(arg);
  const { data, error, pending } = useKeptLoad(`tipps:${weekArg ?? ""}`, () => loadTipsData(parseWeekKey(weekArg)));
  const player = usePlayer(data?.standings ?? null);
  const mode: Mode | null = !data?.week ? null : !data.tips ? "folgt" : data.phase === "vergangen" ? "vergangen" : "offen";
  // Eigene Abweichung pro Woche (D052), Tipps und Spiele zeigen dieselbe Wahl
  const choice = useChoices(player, data?.ref);
  const shownTips = useShownTips(data?.week ? (data.tips ?? null) : null, data?.week?.games, choice.choices);

  // Nachbarwochen im Hintergrund vorladen, damit der nächste Wechsel aus dem Cache kommt
  useEffect(() => {
    if (data) prefetchNeighbours(data, loadTipsData);
  }, [data]);
  const shownRef = data?.ref;
  useEffect(() => {
    setShownWeek(shownRef ?? null);
  }, [shownRef]);

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
  const tips = shownTips ?? placeholderTips(data.week);
  return (
    <TipsList
      key={`${data.ref.season}-${data.ref.seasonType}-${data.ref.week}`}
      data={data}
      week={data.week}
      tips={tips}
      mode={mode ?? "folgt"}
      player={player}
      choice={choice}
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
    schemaVersion: TIPS_SCHEMA_VERSION,
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
  // Im Duo (side, wide) ist die Zeile schmal: ohne Zeitzonenzusatz, er steht in den Einstellungen
  const layout = useLayoutValue();
  const zone = layout === "side" || layout === "wide" ? "" : ` · ${TIME_ZONE_TEXT}`;
  const meta = updatedAt ? `Saison ${data.ref.season} · ${formatStand(updatedAt)}${zone}` : `Saison ${data.ref.season}${zone}`;
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
  selectedId: hashSelectedId,
  player,
  choice,
}: {
  data: TipsData;
  week: WeekFile;
  tips: TipsFile;
  mode: Mode;
  player: string;
  choice: ChoiceState;
  pending: boolean;
  /** Gewähltes Spiel aus dem Hash, null heisst Standardspiel. */
  selectedId: string | null;
}) {
  const layout = useLayoutValue();
  const now = useNow();
  // Pfeile wechseln das Spiel sofort lokal, der Hash folgt einmal nach einer kurzen Pause. Vorher löste jeder
  // Pfeiltipp über den Hash ein Neuzeichnen der ganzen App aus (Nutzerbug Duo aufgeklappt 2026-11-08).
  const [localSel, setLocalSel] = useState<{ id: string | null; from: string | null } | null>(null);
  const selectedId = localSel && localSel.from === hashSelectedId ? localSel.id : hashSelectedId;
  const stepTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (stepTimer.current !== null) window.clearTimeout(stepTimer.current);
    },
    [],
  );
  const readOnly = mode === "vergangen";
  // Ohne Häkchen und Filter: vergangene Wochen und Wochen ohne Tippdatei
  const passive = mode !== "offen";
  const games = week.games;
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const live = useLiveScores(readOnly ? null : data.ref, readOnly ? null : games);
  // Endstand aus den Live Daten zählt sofort, wie in der Spielansicht (shownResult): alle Ansichten zeigen
  // gleichzeitig richtig oder falsch, auch bevor der stündliche Job die Wochendatei final schreibt
  const gameById = useMemo(
    () => new Map((games ?? []).map((g) => [g.id, withLiveFinal(g, live.games.get(g.id))])),
    [games, live.games],
  );
  const current = currentRef(data.current);
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
    [tips, gameById, now, mode],
  );

  // Häkchen des Hauptnutzers, beim ersten Zeichnen aus dem Storage gelesen
  const [entered, setEntered] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const t of tips.tips) {
      const v = readEntered(player, tips, t.gameId);
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
    writeEntered(player, tips, row.gameId, value);
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
  // Gesperrte Zeilen zählen nie als offen, auch mit geändertem Tipp: eintragen geht nicht mehr.
  // Der Hinweis "Tipp geändert" bleibt in der Zeile stehen.
  const isPending = (r: TipRow) => entryPending(r, statusOf(r), passive);
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
    // Filter Offen: Standard ist das nächste offene Spiel, laufende Spiele stehen im Reiter Spiele.
    // Filter Alle: ein laufendes Spiel zuerst
    const pick = filter === "offen" ? (next ?? running) : (running ?? next);
    const showsRunning = pick !== undefined && pick === running;
    const target: HeroTarget | null =
      pick && pick.game
        ? { tip: pick, game: pick.game, tiebreaker: tips.tiebreakers.find((tb) => tb.gameId === pick.gameId) }
        : null;
    const nextInfo: HeroNext | null =
      showsRunning && next?.game
        ? { matchup: `${team(next.game.awayId).abbr} @ ${team(next.game.homeId).abbr}`, kickoffUtc: next.kickoffUtc }
        : null;
    return {
      hero: target,
      heroEmpty: (open.length > 0 ? "ohne_daten" : "gesperrt") as HeroEmpty,
      heroLive: showsRunning && running ? (live.games.get(running.gameId) ?? null) : null,
      heroNext: nextInfo,
    };
    // team hängt nur von teamById ab
  }, [rows, tips, now, live.games, teamById, mode, filter]);

  const header = <TipsHeader data={data} updatedAt={data.tips ? tips.updatedAt : undefined} pending={pending} />;
  // ---------- Auswahl eines Spiels (List Detail, D037) ----------
  // Aktuelle Woche ohne Woche im Hash, damit die Home Bildschirm App nach dem Wochenwechsel mitzieht (D055)
  const hashFor = (id: string | null) => viewHash("tipps", data.ref, current, id);
  const baseHash = hashFor(null);
  const defaultId = hero?.game.id ?? null;
  const selectedRow = selectedId ? rows.find((r) => r.gameId === selectedId && r.game) : undefined;
  const shownRow = selectedRow ?? (defaultId ? rows.find((r) => r.gameId === defaultId) : undefined);
  const wide = layout === "wide";
  // wide wählt nur das Spiel im Spielbereich: Eintrag ersetzen. Sonst öffnet die Auswahl ein Blatt mit genau
  // einem Verlaufseintrag, den Schliessen wieder verlässt (Zurück öffnet das Blatt nicht erneut)
  const select = (id: string) => (wide ? replaceHash(hashFor(id)) : openSheetHash(hashFor(id)));
  const closeSheet = () => closeSheetHash(baseHash);
  // Pfeile und Rücksprung im Spielbereich ersetzen den Verlaufseintrag, sonst sammelt jeder Klick einen an
  const step = (id: string | null) => {
    setLocalSel({ id, from: hashSelectedId });
    if (stepTimer.current !== null) window.clearTimeout(stepTimer.current);
    stepTimer.current = window.setTimeout(() => {
      stepTimer.current = null;
      replaceHash(hashFor(id));
    }, 400);
  };
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

  // Kandidaten "Abweichung möglich" aus Vorschlag und ESPN Tippverteilung (D052). Nur in offenen Wochen.
  const facts = useFactsData(mode === "offen" ? data.ref : null);
  const candidates = useMemo(
    () => (mode === "offen" ? deviationCandidates(tips, games, facts?.picks ?? null, new Date(now).toISOString()) : new Map()),
    [mode, tips, games, facts, now],
  );
  const ownIds = useMemo(
    () => new Set(Object.keys(choice.choices).filter((id) => tips.tips.find((t) => t.gameId === id)?.deviation)),
    [choice.choices, tips],
  );
  // Knopf im Spielblatt: Vorschlag der App aus pHome, gewählt ist der Aussenseiter
  const choiceOf = (row: TipRow | undefined): HeroChoice | null => {
    if (mode !== "offen" || !row || !row.game) return null;
    const oc = outsiderChoice(row, row.game, now);
    if (!oc) return null;
    const own = ownIds.has(row.gameId);
    return {
      own,
      favoriteAbbr: team(oc.favoriteId).abbr,
      underdogAbbr: team(oc.underdogId).abbr,
      locked: oc.locked,
      onToggle: () => choice.setChoice(row.gameId, own ? null : oc.underdogId),
    };
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
    // Am Ende der Liste bleibt der Pfeil fokussierbar (aria-disabled statt disabled), sonst fiele der Fokus
    // beim letzten Schritt auf die Seite. Der Fokus wechselt dann auf den anderen Pfeil.
    const arrowStep = (e: { currentTarget: HTMLElement }, row: TipRow | undefined, dir: "prev" | "next") => {
      if (!row) return;
      const i = visibleOrder.findIndex((r) => r.gameId === row.gameId);
      const atEnd = dir === "next" ? i === visibleOrder.length - 1 : i === 0;
      const group = e.currentTarget.closest(".hero-nav");
      step(row.gameId);
      if (atEnd && group) {
        window.requestAnimationFrame(() =>
          group.querySelector<HTMLElement>(dir === "next" ? ".hero-nav-prev" : ".hero-nav-next")?.focus(),
        );
      }
    };
    const nav =
      useSelection && shownRow ? (
        <div className="hero-nav" role="group" aria-label="Spiel wählen">
          <button
            type="button"
            className="hero-nav-arrow hero-nav-prev"
            aria-disabled={!prevRow || undefined}
            aria-label={prevRow ? `Vorheriges Spiel, ${matchupOf(prevRow)}` : "Kein vorheriges Spiel"}
            onClick={(e) => arrowStep(e, prevRow, "prev")}
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
              // Kurz, damit der Zähler auch im Duo quer nicht abgeschnitten wird
              <>
                <span aria-hidden="true">{live.games.get(shownRow.gameId)?.state === "in" ? "Live" : "\u2013"}</span>
                <span className="sr-only">Spiel ausserhalb des Filters</span>
              </>
            )}
          </span>
          <button
            type="button"
            className="hero-nav-arrow hero-nav-next"
            aria-disabled={!nextRow || undefined}
            aria-label={nextRow ? `Nächstes Spiel, ${matchupOf(nextRow)}` : "Kein nächstes Spiel"}
            onClick={(e) => arrowStep(e, nextRow, "next")}
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
            onClick={() => step(inSheet ? defaultId : null)}
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
        tickerHref={hp.game ? viewHash("spiele", data.ref, current, hp.game.id) : "#spiele"}
        choice={hp.target ? choiceOf(rows.find((r) => r.gameId === hp.target!.game.id)) : null}
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

  // Diese Woche aus den Zeilen, wie die Liste sie zeigt: mit eigener Wahl und Endstand aus Live
  const weekTally = useMemo((): WeekTally => {
    const scored = rows.filter((r) => r.result === "richtig" || r.result === "falsch" || r.result === "unentschieden");
    return { right: scored.filter((r) => r.result === "richtig").length, scored: scored.length };
  }, [rows]);
  const tiles = (
    <div className="tiles">
      <TiebreakerBox tips={tips} gameById={gameById} team={team} open={mode === "folgt"} />
      <OwnSeasonBox data={data} player={player} week={weekTally} />
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
                    own={ownIds.has(row.gameId)}
                    candidate={candidates.has(row.gameId)}
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
        <PageSplitMark />
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
        <GameSheet title={matchupOf(selectedRow)} onClose={closeSheet}>
          {renderHero(true)}
        </GameSheet>
      )}
    </>
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
                {kickoff && (
                  <>
                    Kickoff <span className="nowrap">{formatKickoffZurich(kickoff)}</span>
                  </>
                )}
                {open ? " · Resultat offen" : tb.basis === "standard" ? " · Standardwert" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Deine Saison (D058): richtige App Tipps und Trefferquote der Saison bis jetzt, mit der eigenen Wahl wie in der
 * Bilanz. Die angezeigte Woche zählt aus der Tippliste, damit Endstände aus Live sofort mitzählen.
 */
function OwnSeasonBox({ data, player, week }: { data: TipsData; player: string; week: WeekTally }) {
  const reviews = useSeasonReviews(data.ref.season, player);
  const tally = useMemo(() => (reviews ? ownSeasonTally(reviews.reviews, reviews.choices, data.ref, week) : null), [reviews, data.ref, week]);
  const weekName = data.phase === "aktuell" ? "Diese Woche" : weekLabel(data.ref);
  return (
    <section className="box own-season" aria-label="Deine Saison">
      <h2>Deine Saison</h2>
      {!tally ? (
        <p className="box-meta">Wird geladen …</p>
      ) : tally.scored === 0 ? (
        <p className="box-meta">Noch kein Tipp gewertet. Sobald das erste Spiel beendet ist, steht hier deine Bilanz.</p>
      ) : (
        <>
          <p className="box-big">
            {tally.right} <span className="of">von {tally.scored}</span>
          </p>
          <p className="box-meta">
            Richtige App Tipps, Trefferquote {Math.round((tally.right / tally.scored) * 100)} %
          </p>
        </>
      )}
      <p className="box-meta">
        {weekName}: {week.scored === 0 ? "noch kein Spiel gewertet" : `${week.right} von ${week.scored} richtig`}
      </p>
      <a className="box-link" href="#bilanz/saison">
        Zur Saisonbilanz
      </a>
    </section>
  );
}

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
  own = false,
  candidate = false,
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
  /** Eigene Abweichung des Nutzers (D052). */
  own?: boolean;
  /** Kandidat "Abweichung möglich" (D052). */
  candidate?: boolean;
}) {
  const notCaptured = row.level === "nicht_erfasst";
  const checked = status === "done";
  const { game } = row;
  const hasPick = row.level !== "offen" && !notCaptured && row.pickTeamId !== null;
  const pick = hasPick ? team(row.pickTeamId!) : null;
  const away = game ? team(game.awayId) : null;
  const home = game ? team(game.homeId) : null;
  const pending = entryPending(row, status, readOnly || upcoming);
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
        ? `${pct} %`
        : "keine Quote";
  const infoAria = upcoming
    ? "Quote folgt"
    : notCaptured
      ? "kein App Tipp"
      : pct !== null
        ? `${row.deviation ? (own ? "deine Abweichung, " : "Abweichung, ") : ""}${candidate && !row.deviation ? "Abweichung möglich, " : ""}Siegwahrscheinlichkeit ${pct} Prozent`
        : "keine Quote";
  const infoColor = row.deviation && pct !== null ? "var(--unklar)" : LEVEL_COLOR[row.level];
  // Bei einer Abweichung beschreibt die Marke die Abweichung, nicht die Lage des Favoriten (sonst "klar" neben 22 %)
  const levelTag = levelLabel(row, own, true);
  const levelCls = row.deviation && pct !== null ? "level level-tag-unklar" : `level level-tag-${row.level}`;
  const liveText = live?.state === "in" && game ? `Live ${live.awayScore ?? 0} : ${live.homeScore ?? 0} ${periodText(live)}` : "";
  const finalText = finished && game ? scoreText(game.awayScore!, game.homeScore!) : "";
  const matchup = away && home ? `${away.abbr} @ ${home.abbr}` : `Spiel ${row.gameId}`;
  const label = pick ? pick.abbr : `Spiel ${matchup}`;
  const showCandidate = candidate && !row.deviation && !row.locked && !readOnly;
  const hasFlags = row.tiebreaker || row.deviation || showCandidate || previous !== null || (row.locked && !readOnly && !finished);
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
          aria-label={`${matchup}, Tipp ${pick ? pick.abbr : notCaptured ? "keiner" : "offen"}, ${infoAria}${ariaScore}${showResult && row.result ? `, ${RESULT_BADGE[row.result].text}` : ""}. Im Spielbereich zeigen`}
        >
          {pick ? <TeamLogo team={pick} size={24} className="tip-logo" /> : <span className="logo-placeholder tip-logo" aria-hidden="true" />}
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
              <span className={levelCls}>{levelTag}</span>
            </span>
          )}
        </button>
        {showResult && row.result ? (
          <span className={RESULT_BADGE[row.result].cls}>{RESULT_BADGE[row.result].text}</span>
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
            <span className="flag flag-dev" title={own ? "Eigene Wahl gegen den Vorschlag der App" : "Abweichung vom Favoriten"}>
              <span aria-hidden="true">🎯</span> {own ? "deine Abweichung" : "Abweichung"}
            </span>
          )}
          {showCandidate && (
            <span className="flag flag-candidate" title="Knappes Spiel, Aussenseiter selten getippt">
              Abweichung möglich
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
