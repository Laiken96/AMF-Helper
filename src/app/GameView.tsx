// Spielansicht für geplante und beendete Spiele im Reiter Spiele (D056), im Stil des Livetickers (D054).
// Kopf im Flutlicht Stil mit grossen Logos und Teamfarben. Vor dem Spiel Countdown, Ring mit Siegchance des Tipps,
// Fakten als Kacheln und die Karte "Abweichung möglich" (D052). Nach dem Spiel Endstand, Viertel, Ergebnis des
// Tipps, Punktspielzüge, Teamvergleich und Top Spieler aus der ESPN Summary, einmal geladen.
import type { ReactNode } from "react";
import type { Game, Team } from "../core/schema";
import type { GameTip, TipsFile } from "../core/tips-schema";
import { teamColor, visibleOn } from "./colors";
import { FlagIcon, useGameFactsModel, type GameFactsModel } from "./GameFacts";
import { Ring } from "./GameHero";
import {
  gameState,
  kickoffCountdown,
  kickoffLine,
  levelLabel,
  outsiderChoice,
  resultText,
  shownResult,
  teamLines,
  teamRecords,
  tvText,
  winnerSide,
} from "./game-view";
import { candidateText } from "./facts";
import { useLayoutValue } from "./layout";
import { useGameSummary, type LiveGame } from "./live";
import { Block, LineScore, Leaders, Scoring, StatBars, headStyle } from "./LiveTicker";
import { Spoken, TeamLogo } from "./ui";
import { SLOT_SHORT, scoreAria, scoreText } from "./wording";

type Tiebreaker = TipsFile["tiebreakers"][number];

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const CrossIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </svg>
);

const DashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <path d="M6 12h12" />
  </svg>
);

const WarnIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 3.5l9.5 16.5h-19z" strokeLinejoin="round" />
    <path d="M12 10v4.5" />
    <path d="M12 17.5h.01" />
  </svg>
);

export interface GameViewProps {
  game: Game;
  live: LiveGame | undefined;
  /** Angezeigter Tipp, mit eigener Wahl (shownTipsFor). */
  tip: GameTip | undefined;
  tiebreaker?: Tiebreaker;
  /** Angezeigter Tipp ist die eigene Abweichung (D052). */
  own: boolean;
  team: (id: string) => Team;
  now: number;
  tipsHref: string;
  /** Eigene Wahl setzen, null heisst zurück zum Favoriten. Fehlt in vergangenen Wochen. */
  onChoice?: ((gameId: string, teamId: string | null) => void) | null;
  /** Kommende Woche ohne Tippliste: Hinweis statt Tipp. */
  tipsPending?: boolean;
}

/** Spielansicht eines nicht laufenden Spiels. Im Blatt (compact, side, medium) und links im Duo quer gleich. */
export function GameView({ game, live, tip, tiebreaker, own, team, now, tipsHref, onChoice = null, tipsPending = false }: GameViewProps) {
  const away = team(game.awayId);
  const home = team(game.homeId);
  const st = gameState(game, live);
  const post = st.showScore;
  const final = st.status === "final" && post;
  // Summary einmal laden: vor dem Spiel für Bilanz und TV, nach dem Spiel für Punkte, Statistik und Top Spieler
  const summaryId = st.status === "scheduled" || final ? game.id : null;
  const { summary, loading } = useGameSummary(summaryId, final ? "post" : "pre");
  const model = useGameFactsModel(game, tip, team, now);
  const records = teamRecords(summary, live, away.id, home.id);
  const tv = tvText(summary, live);

  return (
    <article className="ticker gv" aria-label={`Spiel ${away.abbr} @ ${home.abbr}`}>
      {post ? (
        <PostHead game={game} st={st} final={final} away={away} home={home} records={records} tv={tv} tip={tip} summary={summary} live={live} now={now} />
      ) : (
        <PreHead game={game} st={st} away={away} home={home} records={records} tv={tv} tip={tip} tiebreaker={tiebreaker} own={own} now={now} tipsPending={tipsPending} />
      )}
      <div className="tk-body">
        {!post && <ChoiceCard game={game} tip={tip} own={own} model={model} now={now} onChoice={onChoice} />}
        {post && final && loading && <p className="tk-hint">Spieldaten werden geladen …</p>}
        {post && summary && summary.scoring.length > 0 && (
          <Block id="scoring" title="Punkte" collapsible={false} open onToggle={() => undefined}>
            <Scoring summary={summary} team={team} away={away} home={home} />
          </Block>
        )}
        {post && summary && (summary.stats.length > 0 || summary.leaders.length > 0) && (
          <Block id="stats" title="Teamvergleich" collapsible={false} open onToggle={() => undefined}>
            {summary.stats.length > 0 && <StatBars rows={summary.stats} away={away} home={home} />}
            <Leaders leaders={summary.leaders} away={away} home={home} />
          </Block>
        )}
        <FactTiles game={game} model={model} team={team} title={post ? "Vor dem Spiel" : "Fakten"} />
        {tip && tip.level !== "nicht_erfasst" && (
          <a className="btn game-detail-link" href={tipsHref}>
            Zur Tippseite
          </a>
        )}
      </div>
    </article>
  );
}

type State = ReturnType<typeof gameState>;

function pickOf(tip: GameTip | undefined): string | null {
  return tip && tip.pickTeamId && tip.level !== "offen" && tip.level !== "nicht_erfasst" ? tip.pickTeamId : null;
}

// ---------- Kopf vor dem Spiel ----------

function PreHead({
  game,
  st,
  away,
  home,
  records,
  tv,
  tip,
  tiebreaker,
  own,
  now,
  tipsPending,
}: {
  game: Game;
  st: State;
  away: Team;
  home: Team;
  records: { away: string | null; home: string | null };
  tv: string | null;
  tip: GameTip | undefined;
  tiebreaker: Tiebreaker | undefined;
  own: boolean;
  now: number;
  tipsPending: boolean;
}) {
  const layout = useLayoutValue();
  const pickId = pickOf(tip);
  const pick = pickId === home.id ? home : pickId === away.id ? away : null;
  const other = pick ? (pick.id === home.id ? away : home) : null;
  const pickColor = pick ? visibleOn(teamColor(pick.color), "#1B2230", 3) : "#F5B83D";
  const otherColor = other ? visibleOn(teamColor(other.color), "#1B2230", 1.8) : "#3A414D";
  const off = st.status === "postponed" || st.status === "canceled";
  const pill = off ? st.statusText : kickoffCountdown(game.kickoffUtc, now);
  const ringSize = layout === "side" ? 84 : layout === "wide" ? 120 : 100;
  const logoSize = layout === "side" ? 52 : 64;
  const col = (t: Team, record: string | null, side: "away" | "home") => (
    <div className={`gv-team gv-team-${side}`}>
      <TeamLogo team={t} size={logoSize} className="tk-logo gv-logo" onDark />
      <span className="tk-abbr">{t.abbr}</span>
      <span className="tk-name">{t.shortName}</span>
      {record && <span className="tk-record">Bilanz {record}</span>}
    </div>
  );
  const tipValue = pick ? `${pick.abbr} gewinnt` : tip?.level === "nicht_erfasst" ? "kein App Tipp" : tipsPending ? "folgt" : "offen";
  const tipSub = pick && tip ? levelLabel(tip, own) : tipsPending ? "sobald Quoten da sind" : null;
  const slot = tiebreaker ? ` · ${SLOT_SHORT[tiebreaker.slot]}` : "";
  return (
    <div className="tk-head gv-head" style={headStyle(away, home)}>
      <div className="tk-top">
        <span className="tk-live gv-pill">{pill}</span>
        {tv && <span className="tk-tv">TV {tv}</span>}
      </div>
      <div className="gv-teams">
        {col(away, records.away, "away")}
        <div className="gv-ring">
          <Ring prob={pick ? tip!.pickProb : null} pick={pick} pickColor={pickColor} otherColor={otherColor} size={ringSize} withLabel={layout !== "side"} />
        </div>
        {col(home, records.home, "home")}
      </div>
      {game.neutralSite && <p className="gv-neutral">Neutraler Platz, {home.abbr} nominell Heim</p>}
      <dl className="gv-fields">
        <div>
          <dt>Dein Tipp</dt>
          <dd>
            <span className="gv-field-main">{tipValue}</span>
            {tipSub && <span className="gv-field-sub">{tipSub}</span>}
          </dd>
        </div>
        <div>
          <dt>Kickoff{slot}</dt>
          <dd>
            <span className="gv-field-main gv-field-time">{kickoffLine(game.kickoffUtc)}</span>
          </dd>
        </div>
        {tiebreaker && (
          <div>
            <dt>Tiebreaker</dt>
            <dd>
              <Spoken
                className="gv-field-main"
                shown={scoreText(tiebreaker.awayPoints, tiebreaker.homePoints)}
                spoken={scoreAria(tiebreaker.awayPoints, tiebreaker.homePoints, `Tipp ${away.abbr} zu ${home.abbr}`)}
              />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ---------- Kopf nach dem Spiel ----------

function PostHead({
  game,
  st,
  final,
  away,
  home,
  records,
  tv,
  tip,
  summary,
  live,
  now,
}: {
  game: Game;
  st: State;
  final: boolean;
  away: Team;
  home: Team;
  records: { away: string | null; home: string | null };
  tv: string | null;
  tip: GameTip | undefined;
  summary: Parameters<typeof teamLines>[0];
  live: LiveGame | undefined;
  now: number;
}) {
  const side = final ? winnerSide(st.awayScore, st.homeScore) : null;
  const result = shownResult(tip, game, final, st.awayScore, st.homeScore, now);
  const pickId = pickOf(tip);
  const lines = teamLines(summary, live, away.id, home.id);
  const winnerAbbr = side === "away" ? away.abbr : side === "home" ? home.abbr : null;
  const team = (t: Team, score: number | null, record: string | null, s: "away" | "home") => {
    const win = side === s;
    const lose = side !== null && side !== "tie" && !win;
    return (
      <div className={`tk-team tk-team-${s}${win ? " gv-win" : ""}${lose ? " gv-lose" : ""}`}>
        <TeamLogo team={t} size={56} className="tk-logo" onDark />
        <span className="tk-abbr">
          {t.abbr}
          {win && <span className="gv-win-tag">Sieg</span>}
        </span>
        <span className="tk-name">{t.shortName}</span>
        {record && <span className="tk-record">Bilanz {record}</span>}
        <span className="tk-score" aria-hidden="true">
          {score ?? "–"}
        </span>
      </div>
    );
  };
  const kind = result === "richtig" ? "ok" : result === "ungewertet" ? "neutral" : "bad";
  return (
    <div className="tk-head gv-head" style={headStyle(away, home)}>
      <div className="tk-top">
        <span className="tk-live gv-pill">{st.statusText}</span>
        {tv && <span className="tk-tv">TV {tv}</span>}
      </div>
      <p className="sr-only">
        {final ? "Endstand" : "Spielstand"} {away.abbr} {st.awayScore} zu {st.homeScore} {home.abbr}
        {winnerAbbr ? `, Sieger ${winnerAbbr}` : ""}
      </p>
      <div className="tk-teams">
        {team(away, st.awayScore, records.away, "away")}
        <span className="tk-colon" aria-hidden="true">
          :
        </span>
        {team(home, st.homeScore, records.home, "home")}
      </div>
      {result && (
        <p className={`gv-result gv-result-${kind}`}>
          {kind === "ok" ? <CheckIcon /> : kind === "bad" ? <CrossIcon /> : <DashIcon />}
          <span>{resultText(result, pickId === away.id ? away.abbr : pickId === home.id ? home.abbr : null)}</span>
        </p>
      )}
      <LineScore
        away={away}
        home={home}
        awayLines={lines.away}
        homeLines={lines.home}
        awayTotal={st.awayScore}
        homeTotal={st.homeScore}
        period={null}
      />
      <p className="gv-when">{kickoffLine(game.kickoffUtc)}</p>
    </div>
  );
}

// ---------- Abweichung möglich (D052) ----------

function ChoiceCard({
  game,
  tip,
  own,
  model,
  now,
  onChoice,
}: {
  game: Game;
  tip: GameTip | undefined;
  own: boolean;
  model: GameFactsModel;
  now: number;
  onChoice: ((gameId: string, teamId: string | null) => void) | null;
}) {
  const { candidate, signals, abbr, pickId, suggestionId } = model;
  const isOwn = own && pickId !== null;
  // Gleiche Regel wie im Blatt der Tipps: Knopf bei jedem nicht gesperrten Spiel mit Tipp (D052).
  // Die Karte "Abweichung möglich" nur bei Kandidaten, sonst nur Signale und Knopf
  const choice = onChoice ? outsiderChoice(tip, game, now) : null;
  const showButton = choice !== null && !choice.locked;
  if (!candidate && !isOwn && signals.length === 0 && !showButton) return null;
  const tag = isOwn ? "Deine Abweichung" : candidate ? "Abweichung möglich" : signals.length > 0 ? "Signale zum Aussenseiter" : null;
  return (
    <section
      className={`gv-choice${isOwn ? " gv-choice-own" : ""}${tag === null ? " gv-choice-plain" : ""}`}
      aria-label={tag ?? "Eigene Wahl"}
    >
      {tag && (
        <p className="gv-choice-tag">
          <FlagIcon />
          {tag}
        </p>
      )}
      {isOwn && (
        <p className="gv-choice-text">
          Du tippst {abbr(pickId!)}
          {suggestionId && suggestionId !== pickId ? `, Vorschlag der App ist ${abbr(suggestionId)}.` : "."}
        </p>
      )}
      {candidate && <p className="gv-choice-text">{candidateText(candidate, abbr)}</p>}
      {signals.length > 0 && (
        <ul className="gv-signals" aria-label="Signale für den Aussenseiter">
          {signals.map((sig) => (
            <li key={sig.kind}>
              <FlagIcon />
              <span>{sig.text}</span>
            </li>
          ))}
        </ul>
      )}
      {choice &&
        (choice.locked ? (
          isOwn && <p className="gv-choice-text">Kickoff vorbei, die Wahl ist gesperrt.</p>
        ) : (
          <button
            type="button"
            className={`gv-choice-btn${isOwn ? " gv-choice-btn-own" : ""}`}
            onClick={() => onChoice!(game.id, isOwn ? null : choice.underdogId)}
          >
            {isOwn ? `Zurück zum Favoriten ${abbr(choice.favoriteId)}` : `Aussenseiter tippen: ${abbr(choice.underdogId)}`}
          </button>
        ))}
    </section>
  );
}

// ---------- Fakten als Kacheln ----------

function Tile({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`gv-tile${wide ? " gv-tile-wide" : ""}`}>
      <h3 className="gv-tile-label">{label}</h3>
      {children}
    </div>
  );
}

function FactTiles({ game, model, team, title }: { game: Game; model: GameFactsModel; team: (id: string) => Team; title: string }) {
  const { market, fpi, picks, venue, pickId, absences } = model;
  const away = team(game.awayId);
  const home = team(game.homeId);
  const byAbbr = (a: string) => (a === away.abbr ? away : a === home.abbr ? home : null);
  const logo = (t: Team | null) => (t ? <TeamLogo team={t} size={22} className="gv-tile-logo" /> : null);
  const pickTeam = pickId === away.id ? away : pickId === home.id ? home : null;
  const tiles: { key: string; wide: boolean; node: ReactNode }[] = [];

  if (market) {
    tiles.push({
      key: "markt",
      wide: false,
      node: (
        <>
          <div className="gv-tile-col" aria-hidden="true">
            {market.prob && (
              <span className="gv-tile-main">
                {logo(pickTeam)}
                {market.prob}
              </span>
            )}
            {market.line && <span className={market.prob ? "gv-tile-sub" : "gv-tile-main"}>{market.line}</span>}
            {market.start && <span className="gv-tile-move">{market.start}</span>}
          </div>
          <span className="sr-only">{market.spoken}</span>
        </>
      ),
    });
  }
  if (fpi) {
    tiles.push({
      key: "fpi",
      wide: false,
      node: (
        <>
          <span className="gv-tile-main">
            {logo(byAbbr(fpi.abbr))}
            {fpi.abbr} {fpi.pct} %
          </span>
          {fpi.large && fpi.gapText && (
            <span className="gv-tile-flag">
              <FlagIcon />
              {fpi.gapText}
            </span>
          )}
          <span className="gv-tile-note">Modell, nur zum Vergleich</span>
        </>
      ),
    });
  }
  if (picks) {
    tiles.push({
      key: "picks",
      wide: true,
      node: (
        <>
          <span className="gv-tile-main">{picks.headline}</span>
          <span className="gv-pbar" aria-hidden="true">
            <span className={pickId === away.id ? "gv-pseg gv-pseg-pick" : "gv-pseg"} style={{ width: `${picks.awayPct}%` }} />
            <span className={pickId === home.id ? "gv-pseg gv-pseg-pick" : "gv-pseg"} style={{ width: `${picks.homePct}%` }} />
          </span>
          <span className="gv-pends" aria-hidden="true">
            <span>
              {logo(away)}
              {away.abbr} {picks.awayPct} %
            </span>
            <span>
              {home.abbr} {picks.homePct} %{logo(home)}
            </span>
          </span>
          <span className="sr-only">
            {away.abbr} {picks.awayPct} Prozent, {home.abbr} {picks.homePct} Prozent.
          </span>
          {picks.pickNote && <span className="gv-tile-sub">{picks.pickNote}</span>}
          <span className="gv-tile-note">{picks.sample}, dein Tipp markiert</span>
        </>
      ),
    });
  }
  if (venue && (venue.place || venue.neutral)) {
    tiles.push({
      key: "ort",
      wide: false,
      node: (
        <>
          {venue.place && <span className="gv-tile-text">{venue.place}</span>}
          {venue.neutral && <span className="gv-tile-tag">neutraler Platz</span>}
        </>
      ),
    });
  }
  const rest = [
    { t: away, days: game.awayRest },
    { t: home, days: game.homeRest },
  ].filter((r): r is { t: Team; days: number } => typeof r.days === "number");
  if (rest.length > 0) {
    tiles.push({
      key: "rest",
      wide: false,
      node: (
        <>
          <ul className="gv-rest">
            {rest.map((r) => (
              <li key={r.t.id}>
                {logo(r.t)}
                <span className="gv-rest-abbr">{r.t.abbr}</span>
                <span className="gv-rest-days">
                  {r.days} {r.days === 1 ? "Tag" : "Tage"}
                </span>
              </li>
            ))}
          </ul>
          {venue?.short && (
            <span className="gv-tile-flag">
              <FlagIcon />
              {venue.short}
            </span>
          )}
        </>
      ),
    });
  }
  if (absences) {
    tiles.push({
      key: "ausfall",
      wide: true,
      node:
        absences.length > 0 ? (
          <ul className="gv-abs">
            {absences.map((a) => (
              <li key={a.teamId}>
                <WarnIcon />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="gv-tile-text">Kein Schlüsselspieler als Out oder Doubtful gemeldet.</span>
        ),
    });
  }
  if (tiles.length === 0) return null;
  // Ungerade Zahl schmaler Kacheln: die letzte füllt die Zeile, damit keine Lücke bleibt
  const singles = tiles.filter((t) => !t.wide);
  if (singles.length % 2 === 1) singles[singles.length - 1]!.wide = true;
  const LABEL: Record<string, string> = {
    markt: "Markt",
    fpi: "ESPN FPI",
    picks: "ESPN Tipps",
    ort: "Ort",
    rest: "Ruhetage",
    ausfall: "Ausfälle",
  };
  return (
    <section className="tk-block gv-facts" aria-label={title}>
      <h2 className="tk-h2 tk-h2-static">{title}</h2>
      <div className="gv-tiles">
        {tiles.map((t) => (
          <Tile key={t.key} label={LABEL[t.key]!} wide={t.wide}>
            {t.node}
          </Tile>
        ))}
      </div>
    </section>
  );
}
