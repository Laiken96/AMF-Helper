import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Game, Team } from "../core/schema";
import type { GameReview, ReviewFile, StandingsHistory } from "../core/review-schema";
import { groupWeekRows } from "../core/standings";
import {
  LoadError,
  compareRef,
  currentRef,
  loadCurrent,
  loadReviewData,
  loadReviewIndex,
  loadWeeksIndex,
  parseWeekKey,
  sameRef,
  weekKey,
  type ReviewData,
  type WeekRef,
} from "./data";
import { LoadErrorNotice, PageHeader, TeamBadge, WeekStepper, fallbackTeam, fetchedFormat, weekLabel } from "./ui";

const RANKING_FORM_URL = "https://github.com/Laiken96/AMF-Helper/issues/new?template=rangliste.yml";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; data: ReviewData };

const errorText = (err: unknown) =>
  err instanceof LoadError ? err.message : "Unerwarteter Fehler beim Laden der Daten.";

interface ReviewWeek {
  ref: WeekRef;
  path: string;
}

/** Bilanzen aus Wochenindex und reviews/index.json vereint, aufsteigend. Beide Dateien dürfen fehlen. */
async function loadReviewWeeks(): Promise<ReviewWeek[]> {
  const [weeksIndex, reviewIndex] = await Promise.all([loadWeeksIndex(), loadReviewIndex()]);
  const map = new Map<string, ReviewWeek>();
  for (const path of reviewIndex ?? []) {
    const m = /(\d{4})-(\d)-(\d{2})\.json$/.exec(path);
    if (!m) continue;
    const ref = { season: Number(m[1]), seasonType: Number(m[2]), week: Number(m[3]) };
    map.set(weekKey(ref), { ref, path });
  }
  for (const w of weeksIndex?.weeks ?? []) {
    if (!w.reviewFile) continue;
    const ref = { season: w.season, seasonType: w.seasonType, week: w.week };
    map.set(weekKey(ref), { ref, path: w.reviewFile });
  }
  return [...map.values()].sort((a, b) => compareRef(a.ref, b.ref));
}

/** Standard: aktuelle Woche, sonst die letzte Bilanz davor, sonst die neueste. */
function defaultWeek(list: ReviewWeek[], current: WeekRef | null): ReviewWeek | undefined {
  if (current) {
    const before = list.filter((w) => compareRef(w.ref, current) <= 0);
    if (before.length > 0) return before[before.length - 1];
  }
  return list[list.length - 1];
}

export function ReviewView({ arg = null }: { arg?: string | null }) {
  const [list, setList] = useState<ReviewWeek[] | null>(null);
  const [current, setCurrent] = useState<WeekRef | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    Promise.all([loadReviewWeeks(), loadCurrent()])
      .then(([weeks, cur]) => {
        if (!active) return;
        if (weeks.length === 0) {
          setState({ kind: "empty" });
          return;
        }
        setCurrent(cur ? currentRef(cur) : null);
        setList(weeks);
      })
      .catch((err: unknown) => active && setState({ kind: "error", message: errorText(err) }));
    return () => {
      active = false;
    };
  }, []);

  const requested = parseWeekKey(arg);
  const fallback = list ? defaultWeek(list, current) : undefined;
  const selected = list ? (requested ? list.find((w) => sameRef(w.ref, requested)) : fallback) : undefined;
  const path = selected?.path ?? null;

  useEffect(() => {
    if (!list || !path) return;
    let active = true;
    setState({ kind: "loading" });
    loadReviewData(
      list.map((w) => w.path),
      path,
    )
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((err: unknown) => active && setState({ kind: "error", message: errorText(err) }));
    return () => {
      active = false;
    };
  }, [list, path]);

  const shown = selected?.ref ?? requested;
  const picker =
    list && shown ? (
      <WeekStepper view="bilanz" weeks={list.map((w) => w.ref)} value={shown} current={fallback?.ref ?? null} />
    ) : null;

  if (state.kind === "empty") {
    return (
      <>
        <PageHeader title="Bilanz" />
        <p className="notice">
          Noch keine Bilanz vorhanden. Sie erscheint, sobald die erste Woche mit App Tipps gespielt ist.
        </p>
      </>
    );
  }
  if (list && requested && !selected) {
    return (
      <>
        <PageHeader kicker="Bilanz" title={weekLabel(requested)} aside={picker} />
        <p className="notice">Für {weekLabel(requested)} gibt es noch keine Bilanz.</p>
      </>
    );
  }
  if (state.kind === "loading") {
    return (
      <>
        {picker}
        <p className="notice">Daten werden geladen …</p>
      </>
    );
  }
  if (state.kind === "error") {
    return (
      <>
        {picker}
        <LoadErrorNotice message={state.message} />
      </>
    );
  }
  return <ReviewContent data={state.data} picker={picker} />;
}

const SLOT_DAY = { thursday: "Do", monday: "Mo" } as const;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function ReviewContent({ data, picker }: { data: ReviewData; picker: ReactNode }) {
  const { review, week, standings, history } = data;
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const gameById = useMemo(() => new Map((week?.games ?? []).map((g) => [g.id, g])), [week]);
  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const matchup = (gameId: string): string => {
    const g = gameById.get(gameId);
    return g ? `${team(g.awayId).abbr} @ ${team(g.homeId).abbr}` : `Spiel ${gameId}`;
  };

  const deviations = review.games.filter((g) => g.deviation);
  // Trefferquote nur über entschiedene Tipps, offene Spiele zählen noch nicht
  const decided = review.games.filter((g) => g.correct !== null).length;
  const openTips = review.games.filter((g) => g.pickTeamId !== null && g.correct === null).length;
  const rate = decided > 0 ? Math.round((review.points / decided) * 100) : null;
  const finals = review.games.filter((g) => g.final).length;

  return (
    <>
      <PageHeader
        kicker="Bilanz"
        title={weekLabel(review)}
        aside={picker}
        meta={`Saison ${review.season}, Stand ${fetchedFormat.format(new Date(review.updatedAt))}`}
      />

      {!review.complete && (
        <p className="notice notice-pending">
          <strong>Zwischenstand.</strong> {finals} von {review.games.length} Spielen sind final, die Bilanz wird
          laufend ergänzt.
        </p>
      )}

      <div className="tiles">
        <section className="box" aria-label="App Punkte">
          <h2>App Punkte</h2>
          <p className="big-number">
            {review.points} <span className="of">von {review.tipped}</span>
          </p>
          <p className="box-meta">
            {review.tipped === 0
              ? "Keine App Tipps in dieser Woche"
              : rate !== null
                ? `Trefferquote ${rate} %`
                : "Noch kein getipptes Spiel entschieden"}
            {openTips > 0 && `, ${openTips} ${openTips === 1 ? "Tipp" : "Tipps"} offen`}
          </p>
        </section>

        <section className="box" aria-label="Abweichungen">
          <h2>Abweichungen</h2>
          {deviations.length === 0 ? (
            <p>Keine Abweichungen diese Woche</p>
          ) : (
            <>
              <ul className="dev-list">
                {deviations.map((g) => (
                  <DeviationLine key={g.gameId} game={g} team={team} />
                ))}
              </ul>
              <p className="box-meta strong">Netto {signed(review.deviationNet)}</p>
            </>
          )}
        </section>
      </div>

      {review.tiebreakers.length > 0 && (
        <section className="slot">
          <h2>Tiebreaker</h2>
          <ul className="review-list">
            {review.tiebreakers.map((tb) => (
              <li key={tb.gameId} className="review-row">
                <span className="tb-day">{SLOT_DAY[tb.slot]}</span>
                <span>
                  {matchup(tb.gameId)}: getippt {tb.predictedAway}:{tb.predictedHome},{" "}
                  {tb.actualAway !== null && tb.actualHome !== null
                    ? `Resultat ${tb.actualAway}:${tb.actualHome}, Abweichung ${tb.diff ?? "offen"}`
                    : "Resultat offen"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <GroupWeek history={history} review={review} me={standings.me} />
      <SeasonTable history={history} season={review.season} me={standings.me} />
      <GameList review={review} gameById={gameById} team={team} />
    </>
  );
}

function DeviationLine({ game, team }: { game: GameReview; team: (id: string) => Team }) {
  const pick = game.pickTeamId ? team(game.pickTeamId).abbr : "?";
  const fav = game.favoriteTeamId ? team(game.favoriteTeamId).abbr : "?";
  const effect = game.deviationEffect;
  const cls = effect === null || effect === 0 ? "effect" : effect > 0 ? "effect effect-plus" : "effect effect-minus";
  return (
    <li>
      {pick} statt {fav}: <span className={cls}>{effect === null ? "offen" : signed(effect)}</span>
    </li>
  );
}

function GroupWeek({ history, review, me }: { history: StandingsHistory; review: ReviewFile; me: string }) {
  const rows = groupWeekRows(history, review.season, review.seasonType, review.week);
  if (!rows) {
    return (
      <section className="slot">
        <h2>Gruppe Week {review.week}</h2>
        <p className="notice notice-pending">
          Rangliste für Week {review.week} noch nicht gemeldet.{" "}
          <a href={RANKING_FORM_URL} target="_blank" rel="noopener noreferrer">
            Rangliste für Week {review.week} melden
          </a>
        </p>
      </section>
    );
  }
  const hasWeek = rows.every((r) => r.week !== null);
  const sorted = [...rows].sort((a, b) => (b.week ?? 0) - (a.week ?? 0) || b.total - a.total || a.id.localeCompare(b.id));
  return (
    <section className="slot">
      <h2>Gruppe Week {review.week}</h2>
      <table className="group-table">
        <thead>
          <tr>
            <th scope="col">Kürzel</th>
            <th scope="col">Woche</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className={r.id === me ? "me" : undefined}>
              <th scope="row">{r.id}</th>
              <td>{r.week ?? "?"}</td>
              <td>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hasWeek && <p className="push-hint">Wochenpunkte fehlen, weil die Vorwoche nicht gemeldet ist.</p>}
    </section>
  );
}

function SeasonTable({ history, season, me }: { history: StandingsHistory; season: number; me: string }) {
  const entries = history.entries
    .filter((e) => e.season === season)
    .sort((a, b) => a.seasonType - b.seasonType || a.week - b.week);
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1]!;
  const ids = [...latest.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id)).map((p) => p.id);
  const anyMissing = entries.some((e) => groupWeekRows(history, season, e.seasonType, e.week)?.some((r) => r.week === null));
  return (
    <section className="slot">
      <h2>Saisonverlauf {season}</h2>
      <div className="table-scroll">
        <table className="season-table">
          <thead>
            <tr>
              <th scope="col">Woche</th>
              {ids.map((id) => (
                <th key={id} scope="col" className={id === me ? "me" : undefined}>
                  {id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const rows = groupWeekRows(history, season, e.seasonType, e.week) ?? [];
              return (
                <tr key={`${e.seasonType}-${e.week}`}>
                  <th scope="row">{e.seasonType === 3 ? `P${e.week}` : e.week}</th>
                  {ids.map((id) => (
                    <td key={id} className={id === me ? "me" : undefined}>
                      {rows.find((r) => r.id === id)?.week ?? "?"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {ids.map((id) => (
                <td key={id} className={id === me ? "me" : undefined}>
                  {latest.players.find((p) => p.id === id)?.points ?? "?"}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {anyMissing && <p className="push-hint">? heisst Vorwoche nicht gemeldet.</p>}
    </section>
  );
}

function GameList({
  review,
  gameById,
  team,
}: {
  review: ReviewFile;
  gameById: Map<string, Game>;
  team: (id: string) => Team;
}) {
  if (review.games.length === 0) return null;
  return (
    <section className="slot">
      <h2>Spiele</h2>
      <ul className="games">
        {review.games.map((g) => {
          const game = gameById.get(g.gameId);
          const result =
            g.correct === null ? (g.pickTeamId ? "offen" : "") : g.correct ? "richtig" : "falsch";
          const resultCls = g.correct === null ? "res res-open" : g.correct ? "res res-ok" : "res res-bad";
          return (
            <li key={g.gameId} className="game review-game">
              <div className="matchup">
                {game ? (
                  <>
                    <TeamBadge team={team(game.awayId)} />
                    {game.awayScore !== null && game.homeScore !== null && game.status !== "scheduled" ? (
                      <span className="score">
                        {game.awayScore} : {game.homeScore}
                      </span>
                    ) : (
                      <span className="at">@</span>
                    )}
                    <TeamBadge team={team(game.homeId)} />
                  </>
                ) : (
                  <span>Spiel {g.gameId}</span>
                )}
              </div>
              <div className="details">
                <span>
                  {g.pickTeamId ? `Tipp ${team(g.pickTeamId).abbr}` : "Kein App Tipp"}
                  {g.deviation ? ", Abweichung" : ""}
                </span>
                <span className={resultCls}>{g.final ? result : "nicht final"}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
