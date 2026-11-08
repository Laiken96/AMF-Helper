import { useEffect, useMemo, type ReactNode } from "react";
import type { Game, Team } from "../core/schema";
import type { GameReview, ReviewFile } from "../core/review-schema";
import { loadReviewPage, parseWeekKey, sameRef, setShownWeek, useKeptLoad, type ReviewData } from "./data";
import { RESULT_BADGE, gameState, reviewResult, winnerSide, withLiveFinal } from "./game-view";
import { useLayoutValue } from "./layout";
import { useLiveScores, type LiveState } from "./live";
import { applyChoicesToReview, useChoices, usePlayer } from "./player";
import { SeasonView } from "./SeasonView";
import { LoadErrorNotice, PageHeader, Segmented, Spoken, TeamBadge, WeekStepper, fallbackTeam, weekLabel, PageSplitMark } from "./ui";
import { SLOT_LONG, SLOT_SHORT, formatStand, scoreAria, scoreText } from "./wording";

/** Hash Argument der Saisonansicht: #bilanz/saison. */
export const SEASON_ARG = "saison";

/** Umschalter Woche oder Saison. Ziel als Hash, damit die Wahl im Verlauf bleibt. */
function ModeToggle({ mode }: { mode: "woche" | "saison" }) {
  return (
    <div className="review-mode">
      <Segmented
        label="Bilanz zeigen"
        value={mode}
        onChange={(v) => {
          if (v !== mode) window.location.hash = v === "saison" ? `#bilanz/${SEASON_ARG}` : "#bilanz";
        }}
        options={[
          { value: "woche", label: "Woche" },
          { value: "saison", label: "Saison" },
        ]}
      />
    </div>
  );
}

export function ReviewView({ arg = null }: { arg?: string | null }) {
  if (arg === SEASON_ARG) return <SeasonView toggle={<ModeToggle mode="saison" />} />;
  return <WeekReview arg={arg} />;
}

function WeekReview({ arg }: { arg: string | null }) {
  const { data, error, pending } = useKeptLoad(`bilanz:${arg ?? ""}`, () => loadReviewPage(parseWeekKey(arg)));

  // Nachbarwochen vorladen
  useEffect(() => {
    if (!data) return;
    const i = data.weeks.findIndex((w) => sameRef(w.ref, data.ref));
    for (const w of [data.weeks[i - 1], data.weeks[i + 1]]) if (w) void loadReviewPage(w.ref).catch(() => undefined);
  }, [data]);
  const shownRef = data?.ref;
  useEffect(() => {
    setShownWeek(shownRef ?? null);
  }, [shownRef]);

  if (error) return <LoadErrorNotice message={error} />;
  if (data === null && !pending) {
    return (
      <>
        <PageHeader title="Bilanz" />
        <p className="notice">
          Noch keine Bilanz vorhanden. Sie erscheint, sobald die erste Woche mit App Tipps gespielt ist.
        </p>
      </>
    );
  }
  if (!data) return <p className="notice">Daten werden geladen …</p>;
  const picker = (
    <WeekStepper view="bilanz" weeks={data.weeks.map((w) => w.ref)} value={data.ref} current={data.home} pending={pending} />
  );
  return <ReviewContent data={data} picker={picker} />;
}

/** Kachel Titel statt "App Punkte": richtige Tipps der App in dieser Woche. */
const POINTS_TITLE = "Richtige App Tipps";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function ReviewContent({ data, picker }: { data: ReviewData; picker: ReactNode }) {
  const { week, standings, ref } = data;
  // Eigene Wahl verrechnet (D057), mit sichtbarem Hinweis
  const player = usePlayer(standings);
  const { choices } = useChoices(player, ref);
  const own = useMemo(
    () => (data.review ? applyChoicesToReview(data.review, choices, week?.games ?? null) : { review: null, changed: 0 }),
    [data.review, choices, week],
  );
  const review = own.review;
  const live = useLiveScores(data.phase === "vergangen" ? null : ref, data.phase === "vergangen" ? null : (week?.games ?? null));
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const gameById = useMemo(() => new Map((week?.games ?? []).map((g) => [g.id, g])), [week]);
  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const wide = useLayoutValue() === "wide";
  const matchup = (gameId: string): string => {
    const g = gameById.get(gameId);
    return g ? `${team(g.awayId).abbr} @ ${team(g.homeId).abbr}` : `Spiel ${gameId}`;
  };

  if (!review) {
    const text = data.beforeStart
      ? `${weekLabel(ref)} liegt vor dem App Start, keine Daten.`
      : data.phase === "vergangen"
        ? "Für diese Woche gibt es keine Bilanz."
        : "Bilanz folgt, sobald das erste Spiel dieser Woche beendet ist.";
    const emptyHeader = (
      <>
        <PageHeader kicker="Bilanz" title={weekLabel(ref)} aside={picker} meta={`Saison ${ref.season}`} />
        <ModeToggle mode="woche" />
      </>
    );
    const emptyNotice = <p className="notice notice-pending">{text}</p>;
    const emptyMetrics = (
      <>
        <div className="tiles">
          <section className="box" aria-label={POINTS_TITLE}>
            <h2>{POINTS_TITLE}</h2>
            <p className="big-number">
              {"\u2013"} <span className="of">von {week?.games.length ?? "\u2013"}</span>
            </p>
            <p className="box-meta">Noch keine Auswertung</p>
          </section>
          <section className="box" aria-label="Abweichungen">
            <h2>Abweichungen</h2>
            <p>Noch keine Auswertung</p>
          </section>
        </div>
      </>
    );
    if (wide) {
      return (
        <ReviewSplit
          metrics={emptyMetrics}
          list={
            <>
              {emptyHeader}
              {emptyNotice}
            </>
          }
        />
      );
    }
    return (
      <>
        {emptyHeader}
        {emptyNotice}
        {emptyMetrics}
      </>
    );
  }

  const deviations = review.games.filter((g) => g.deviation);
  // Trefferquote nur über entschiedene Tipps, offene Spiele zählen noch nicht
  const decided = review.games.filter((g) => g.correct !== null).length;
  const openTips = review.games.filter((g) => g.pickTeamId !== null && g.correct === null).length;
  const rate = decided > 0 ? Math.round((review.points / decided) * 100) : null;
  const finals = review.games.filter((g) => g.final).length;

  const header = (
    <>
      <PageHeader
        kicker="Bilanz"
        title={weekLabel(review)}
        aside={picker}
        meta={`Saison ${review.season} · ${formatStand(review.updatedAt)}`}
      />
      <ModeToggle mode="woche" />
    </>
  );
  const gameList = <GameList review={review} gameById={gameById} team={team} live={live} />;
  const ownNote = own.changed > 0 && (
    <p className="notice own-note">
      <strong>inkl. deiner Abweichungen.</strong> {own.changed} {own.changed === 1 ? "Spiel zählt" : "Spiele zählen"} mit deiner
      eigenen Wahl, gespeichert auf diesem Gerät.
    </p>
  );
  const metrics = (
    <>
      {ownNote}
      {!review.complete && (
        <p className="notice notice-pending">
          <strong>Zwischenstand.</strong> {finals} von {review.games.length} Spielen sind beendet, die Bilanz wird
          laufend ergänzt.
        </p>
      )}

      <div className="tiles">
        <section className="box" aria-label={POINTS_TITLE}>
          <h2>{POINTS_TITLE}</h2>
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
                <abbr className="tb-day" title={SLOT_LONG[tb.slot]}>
                  {SLOT_SHORT[tb.slot]}
                </abbr>
                <span>
                  {matchup(tb.gameId)}: getippt{" "}
                  <Spoken shown={scoreText(tb.predictedAway, tb.predictedHome)} spoken={scoreAria(tb.predictedAway, tb.predictedHome)} />
                  {", "}
                  {tb.actualAway !== null && tb.actualHome !== null ? (
                    <>
                      Resultat{" "}
                      <Spoken
                        shown={scoreText(tb.actualAway, tb.actualHome)}
                        spoken={scoreAria(tb.actualAway, tb.actualHome, "Resultat")}
                      />
                      , {tb.diff === null ? "Abstand offen" : `${tb.diff} Punkte Abstand`}
                    </>
                  ) : (
                    "Resultat offen"
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

    </>
  );

  if (wide) {
    return (
      <ReviewSplit
        metrics={metrics}
        list={
          <>
            {header}
            {gameList}
          </>
        }
      />
    );
  }
  return (
    <>
      {header}
      {metrics}
      {gameList}
    </>
  );
}

/** wide (D050): Kennzahlen links bis zum Falz, Kopf und Spielliste rechts, beide scrollen unabhängig. */
function ReviewSplit({ metrics, list }: { metrics: ReactNode; list: ReactNode }) {
  return (
    <div className="duo-split">
        <PageSplitMark />
      <div className="pane pane-metrics" aria-label="Kennzahlen der Woche" role="region">
        {metrics}
      </div>
      <div className="fold" aria-hidden="true" />
      <div className="pane pane-list">{list}</div>
    </div>
  );
}

function DeviationLine({ game, team }: { game: GameReview; team: (id: string) => Team }) {
  const pick = game.pickTeamId ? team(game.pickTeamId).abbr : "\u2013";
  const fav = game.favoriteTeamId ? team(game.favoriteTeamId).abbr : "\u2013";
  const effect = game.deviationEffect;
  const cls = effect === null || effect === 0 ? "effect" : effect > 0 ? "effect effect-plus" : "effect effect-minus";
  return (
    <li>
      {pick} statt {fav}: <span className={cls}>{effect === null ? "offen" : signed(effect)}</span>
    </li>
  );
}

function GameList({
  review,
  gameById,
  team,
  live,
}: {
  review: ReviewFile;
  gameById: Map<string, Game>;
  team: (id: string) => Team;
  live: LiveState;
}) {
  if (review.games.length === 0) return null;
  const withTip = review.games.filter((g) => g.pickTeamId !== null);
  const without = review.games.filter((g) => g.pickTeamId === null);
  const row = (g: GameReview) => (
    <ReviewGameRow key={g.gameId} g={g} game={gameById.get(g.gameId)} team={team} live={live.games.get(g.gameId)} />
  );
  return (
    <section className="slot">
      <h2>Spiele</h2>
      {withTip.length > 0 && <ul className="games">{withTip.map(row)}</ul>}
      {without.length > 0 && (
        <details className="no-tip-group">
          <summary>
            {without.length} {without.length === 1 ? "Spiel" : "Spiele"} ohne App Tipp
          </summary>
          <ul className="games">{without.map(row)}</ul>
        </details>
      )}
    </section>
  );
}

function ReviewGameRow({
  g,
  game: fileGame,
  team,
  live,
}: {
  g: GameReview;
  game: Game | undefined;
  team: (id: string) => Team;
  live: Parameters<typeof gameState>[1];
}) {
  // Wie im Reiter Spiele: laufend mit Live Stand, geplant als "Geplant", Endstand aus Live sofort
  const game = fileGame ? withLiveFinal(fileGame, live) : undefined;
  const st = game ? gameState(game, live) : null;
  const liveSide = !g.final && game?.status === "final" ? winnerSide(game.awayScore, game.homeScore) : null;
  const liveWinner = liveSide === "away" ? game!.awayId : liveSide === "home" ? game!.homeId : null;
  const result = reviewResult(
    liveSide && g.pickTeamId ? { final: true, pickTeamId: g.pickTeamId, winnerTeamId: liveWinner, correct: liveWinner === g.pickTeamId } : g,
  );
  const scored = st ? st.showScore : false;
  const awayScore = st?.awayScore ?? null;
  const homeScore = st?.homeScore ?? null;
  // Sieger fett, Verlierer gedimmt, nur bei beendetem Spiel
  const side = (score: number | null | undefined, other: number | null | undefined) =>
    game?.status !== "final" || score == null || other == null || score === other
      ? "team-wrap"
      : score > other
        ? "team-wrap team-win"
        : "team-wrap team-lose";
  return (
    <li className="game review-game">
      <div className="matchup">
        {game ? (
          <>
            <span className={side(game.awayScore, game.homeScore)}>
              <TeamBadge team={team(game.awayId)} />
            </span>
            {scored ? <span className="score">{scoreText(awayScore!, homeScore!)}</span> : <span className="at">@</span>}
            <span className={`${side(game.homeScore, game.awayScore)} team-wrap-home`}>
              <TeamBadge team={team(game.homeId)} />
            </span>
          </>
        ) : (
          <span>Spiel {g.gameId}</span>
        )}
      </div>
      {g.pickTeamId && (
        <div className="details">
          <span>
            Tipp {team(g.pickTeamId).abbr}
            {g.deviation ? ", Abweichung" : ""}
          </span>
          {result && result !== "offen" ? (
            <span className={RESULT_BADGE[result].cls}>{RESULT_BADGE[result].text}</span>
          ) : (
            <span className={st?.running ? "status live-tag" : "res res-open"}>
              {st?.running && <span className="live-dot" aria-hidden="true" />}
              {st ? st.statusText : "offen"}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
