import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { InjuriesFile } from "../core/injuries";
import type { Game, Team } from "../core/schema";
import type { GameTip, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich } from "../core/time";
import { shadeForText, teamColor, visibleOn } from "./colors";
import { useLayoutValue } from "./layout";
import { periodText, type LiveGame } from "./live";
import { Spoken, TeamLogo } from "./ui";
import { SLOT_SHORT, formatCountdown, scoreAria, scoreText, statusWord, tippschlussText } from "./wording";
import type { NewsFile } from "../core/extra-schema";
import { GameFacts } from "./GameFacts";
import { absenceText, keyAbsence } from "./facts";
import { useInSheet } from "./Sheet";

type NewsItem = NewsFile["items"][number];

/** Eigene Abweichung im Spielblatt (D052). Nur bei nicht gesperrten Spielen mit Quote. */
export interface HeroChoice {
  /** true, wenn der Aussenseiter gewählt ist. */
  own: boolean;
  favoriteAbbr: string;
  underdogAbbr: string;
  /** Kickoff vorbei oder Spiel nicht mehr geplant: Wahl gesperrt. */
  locked: boolean;
  onToggle: () => void;
}

/** Nächster offener Tippschluss, wenn der Spielbereich ein laufendes Spiel zeigt. */
export interface HeroNext {
  matchup: string;
  kickoffUtc: string;
}

/** Bis zu zwei aktuelle Schlagzeilen zu den beiden Teams, neueste zuerst. Älter als 7 Tage zählt nicht. */
export function heroHeadlines(items: readonly NewsItem[] | undefined, teamIds: readonly string[], now: number, max = 2): NewsItem[] {
  if (!items) return [];
  return items
    .filter((i) => now - Date.parse(i.publishedAt) < 7 * 24 * 3600_000 && i.teamIds.some((id) => teamIds.includes(id)))
    .slice(0, max);
}


export const TIPPSPIEL_URL = "https://tippspiel.footballbromance.com";

type Tiebreaker = TipsFile["tiebreakers"][number];

export interface HeroTarget {
  tip: GameTip;
  game: Game;
  tiebreaker: Tiebreaker | undefined;
}

/** Aktuelle Zeit, jede Minute neu (auf die volle Minute ausgerichtet). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    // Nach dem Zurückkehren in die App sofort aktualisieren, Timer laufen im Hintergrund nicht zuverlässig
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return now;
}

/** Countdown, "3 Tg 21 h". Ausgelagert nach wording.ts, hier für bestehende Importe erneut exportiert. */
export { formatCountdown };

const CIRC = 2 * Math.PI * 56;

/** Ring mit Siegwahrscheinlichkeit des getippten Teams, auch in der Spielansicht (D056). */
export function Ring({
  prob,
  pick,
  pickColor,
  otherColor,
  size,
  withLabel,
}: {
  prob: number | null;
  pick: Team | null;
  pickColor: string;
  otherColor: string;
  size: number;
  withLabel: boolean;
}) {
  const pct = prob === null ? null : Math.round(prob * 100);
  const label =
    pct === null || !pick ? "Siegwahrscheinlichkeit offen, keine Quote" : `Siegwahrscheinlichkeit ${pick.abbr} ${pct} Prozent`;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={label}>
      <circle cx="70" cy="70" r="56" fill="none" stroke={pct === null ? "#3A414D" : otherColor} strokeWidth="13" />
      {pct !== null && (
        <circle
          cx="70"
          cy="70"
          r="56"
          fill="none"
          stroke={pickColor}
          strokeWidth="13"
          strokeDasharray={`${(CIRC * pct) / 100} ${CIRC}`}
          transform="rotate(-90 70 70)"
        />
      )}
      <text x="70" y={withLabel ? 70 : 83} textAnchor="middle" fill="#FFFFFF" className="ring-value">
        {pct === null ? "offen" : `${pct} %`}
      </text>
      {withLabel && pick && pct !== null && (
        <text x="70" y="92" textAnchor="middle" fill="#F2F4F7" className="ring-label">
          Sieg {pick.abbr}
        </text>
      )}
    </svg>
  );
}

/** Warum kein Spiel im Spielbereich steht: alles gesperrt oder offene Spiele ohne Spieldaten. */
export type HeroEmpty = "gesperrt" | "ohne_daten";

/**
 * Art des Spielbereichs. offen: nächster Tippschluss (oder Live Spiel). folgt: kommende Woche ohne Tippdatei,
 * Hinweis statt Ring. final: vergangene Woche, Endstand und Ergebnis des Tipps.
 */
export type HeroVariant = "offen" | "folgt" | "final";

const RESULT_WORD = { richtig: "richtig", falsch: "falsch", unentschieden: "unentschieden", offen: "offen", ungewertet: "ungewertet" } as const;
export type HeroResult = keyof typeof RESULT_WORD;

const WarnIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F5B83D" strokeWidth="2" aria-hidden="true">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

/** Spielbereich in Teamfarben (D037, D038). Gleiche Struktur und Höhe in allen Wochen, nur der Inhalt wechselt. */
export function GameHero({
  target,
  empty = "gesperrt",
  team,
  injuries,
  now,
  live = null,
  next = null,
  headlines = [],
  variant = "offen",
  result = null,
  reviewHref = "#bilanz",
  nav = null,
  choice = null,
}: {
  target: HeroTarget | null;
  empty?: HeroEmpty;
  team: (id: string) => Team;
  injuries: InjuriesFile | null;
  now: number;
  /** Live Stand, wenn das Spiel läuft. Dann Score statt Countdown. */
  live?: LiveGame | null;
  /** Nächster offener Tippschluss, nur bei laufendem Spiel angezeigt. */
  next?: HeroNext | null;
  headlines?: readonly NewsItem[];
  variant?: HeroVariant;
  /** Ergebnis des Tipps, nur bei variant final. */
  result?: HeroResult | null;
  reviewHref?: string;
  /** Pfeile zum Durchblättern der Spiele, oben im Spielbereich. */
  nav?: ReactNode;
  /** Knopf für die eigene Abweichung (D052), nur im Blatt und im grossen Spielbereich. */
  choice?: HeroChoice | null;
}) {
  const layout = useLayoutValue();
  const inSheet = useInSheet();

  if (!target) {
    return (
      <section className="hero hero-empty" aria-label="Nächster Tippschluss">
        {empty === "gesperrt" ? (
          <>
            <p className="hero-empty-title">Alle Tipps dieser Woche gesperrt</p>
            <p className="hero-empty-text">Der nächste Spielbereich erscheint mit der Tippliste der neuen Woche.</p>
          </>
        ) : (
          <>
            <p className="hero-empty-title">Kein offener Tipp mit Spieldaten</p>
            <p className="hero-empty-text">Die offenen Spiele stehen in der Liste.</p>
          </>
        )}
      </section>
    );
  }

  const { tip, game, tiebreaker } = target;
  const away = team(game.awayId);
  const home = team(game.homeId);
  const hasPick = tip.pickTeamId !== null && tip.level !== "offen" && tip.level !== "nicht_erfasst";
  const pick = hasPick ? team(tip.pickTeamId!) : null;
  const other = pick ? (pick.id === home.id ? away : home) : null;
  const pickColor = pick ? visibleOn(teamColor(pick.color), "#1B2230", 3) : "#F5B83D";
  const otherColor = other ? visibleOn(teamColor(other.color), "#1B2230", 1.8) : "#3A414D";
  const style = {
    "--hero-a": shadeForText(teamColor(away.color)),
    "--hero-b": shadeForText(teamColor(home.color)),
  } as CSSProperties;

  const isLive = variant === "offen" && live?.state === "in";
  const isFinal = variant === "final";
  const scores: [number | null, number | null] | null = isLive
    ? [live.awayScore ?? 0, live.homeScore ?? 0]
    : isFinal && game.awayScore !== null && game.homeScore !== null
      ? [game.awayScore, game.homeScore]
      : null;
  const big = layout === "wide";

  // Marke oben rechts: Live, Beendet oder Tippschluss. Immer genau eine Zeile.
  const badge = isLive ? (
    <span className="hero-countdown hero-live">
      <span className="live-dot" aria-hidden="true" />
      <span className="sr-only">Läuft, </span>
      {statusWord(periodText(live))}
    </span>
  ) : isFinal ? (
    <span className="hero-countdown">{game.status === "final" ? statusWord(game.statusDetail) || "Beendet" : "Noch nicht beendet"}</span>
  ) : Date.parse(tip.kickoffUtc) > now ? (
    <span className="hero-countdown">{tippschlussText(Date.parse(tip.kickoffUtc) - now)}</span>
  ) : (
    <span className="hero-countdown">Tippschluss vorbei</span>
  );
  const sectionLabel = isLive ? "Laufendes Spiel" : isFinal ? "Spiel der Woche" : variant === "folgt" ? "Erstes Spiel der Woche" : "Nächster Tippschluss";

  const when = formatKickoffZurich(tip.kickoffUtc).replace(/ (\d\d:\d\d)$/, " · $1");
  const slot = tiebreaker ? ` · ${SLOT_SHORT[tiebreaker.slot]}` : "";
  const absence = variant === "offen" && !isLive ? keyAbsence(injuries, game.id) : null;
  const prob = hasPick ? tip.pickProb : null;
  const noAppTip = tip.level === "nicht_erfasst";
  const tipText = pick ? `${pick.abbr} gewinnt` : noAppTip ? "kein App Tipp" : "offen";
  const tbText = tiebreaker ? (variant === "folgt" ? "offen" : scoreText(tiebreaker.awayPoints, tiebreaker.homePoints)) : null;
  const tbAria =
    tiebreaker && variant !== "folgt" ? scoreAria(tiebreaker.awayPoints, tiebreaker.homePoints, `Tipp ${away.abbr} zu ${home.abbr}`) : undefined;
  const second: { label: string; value: string; aria?: string } | null = isFinal
    ? { label: "Ergebnis", value: result ? RESULT_WORD[result] : "kein Tipp" }
    : tbText
      ? { label: big ? "Resultat Tiebreaker" : "Resultat", value: tbText, aria: tbAria }
      : null;

  // Infozeilen mit fester Höhe, damit der Spielbereich in jeder Woche gleich hoch ist
  const lines: ReactNode[] = [];
  if (variant === "folgt" && layout === "side") lines.push(<span key="folgt">Tipps folgen, sobald Quoten verfügbar sind.</span>);
  if (isLive && next)
    lines.push(<span key="next">Nächster Tippschluss {next.matchup} in {formatCountdown(Date.parse(next.kickoffUtc) - now)}</span>);
  if (isFinal && scores && result) lines.push(<span key="res">Endstand {away.abbr} {scoreText(scores[0]!, scores[1]!)} {home.abbr}, Tipp {RESULT_WORD[result]}</span>);
  if (absence)
    lines.push(
      <span key="abs" className="hero-info-warn">
        <WarnIcon />
        {absenceText(absence)}
      </span>,
    );
  for (const h of headlines)
    lines.push(
      <a key={h.id} href={h.url} target="_blank" rel="noopener noreferrer">
        {h.title}
        <span className="sr-only"> (öffnet in neuem Tab)</span>
      </a>,
    );
  const maxLines = layout === "side" ? 2 : 3;
  const info = (
    <div className="hero-info">
      {lines.slice(0, maxLines).map((l, i) => (
        <div key={i} className="hero-info-line">
          {l}
        </div>
      ))}
    </div>
  );

  // Fakten nur im Blatt und im grossen Spielbereich (wide). Oben in der Liste bleibt der Spielbereich kurz
  const detailed = inSheet || big;
  const facts = detailed ? (
    <GameFacts key={game.id} game={game} tip={tip} team={team} now={now} own={choice?.own ?? false} />
  ) : null;

  // Eigene Abweichung (D052): Knopf bei offenen Spielen, nach Kickoff nur noch der Hinweis
  const why =
    detailed && choice && variant === "offen" && !isLive ? (
      choice.locked ? (
        choice.own ? (
          <p className="hero-why">
            <span className="hero-why-tag">Deine Abweichung</span> Kickoff vorbei, die Wahl ist gesperrt.
          </p>
        ) : null
      ) : (
        <button
          type="button"
          className={`hero-choice${choice.own ? " hero-choice-own" : ""}`}
          onClick={choice.onToggle}
        >
          {choice.own ? `Zurück zum Favoriten ${choice.favoriteAbbr}` : `Aussenseiter tippen: ${choice.underdogAbbr}`}
        </button>
      )
    ) : null;

  const cta = isFinal ? (
    <a className="hero-cta" href={reviewHref}>
      Zur Bilanz
    </a>
  ) : isLive && !next ? (
    <a className="hero-cta" href="#spiele">
      Zum Liveticker
    </a>
  ) : (
    <a className="hero-cta" href={TIPPSPIEL_URL} target="_blank" rel="noopener noreferrer">
      Auf der Tippseite eintragen
    </a>
  );

  const ringSize = layout === "side" ? 72 : big ? 140 : layout === "medium" ? 104 : 112;
  const ring =
    variant === "folgt" ? (
      <div className="ring ring-placeholder" style={{ width: ringSize, height: ringSize }} role="img" aria-label="Tipps folgen, sobald Quoten verfügbar sind">
        <span aria-hidden="true">{layout === "side" ? "Quote folgt" : "Tipps folgen, sobald Quoten verfügbar sind"}</span>
      </div>
    ) : (
      <Ring prob={prob} pick={pick} pickColor={pickColor} otherColor={otherColor} size={ringSize} withLabel={layout !== "side"} />
    );

  const head = (
    <div className="hero-top">
      <span className="hero-when">
        {when}
        {slot}
      </span>
      {badge}
    </div>
  );

  if (layout === "side") {
    return (
      <section className="hero hero-small" style={style} aria-label={sectionLabel}>
        {nav}
        {head}
        <div className="hero-small-body">
          {ring}
          <div className="hero-small-text">
            <span className="hero-matchup hero-matchup-logos">
              <TeamLogo team={away} size={24} className="hero-mini-logo" />
              <span className="hero-matchup-text">
                {scores ? `${away.abbr} ${scores[0]} : ${scores[1]} ${home.abbr}` : `${away.abbr} @ ${home.abbr}`}
              </span>
              <TeamLogo team={home} size={24} className="hero-mini-logo" />
            </span>
            <span>
              Tipp {pick ? pick.abbr : noAppTip ? "kein App Tipp" : "offen"}
              {second && (
                <>
                  {" · "}
                  {second.label} {second.aria ? <Spoken shown={second.value} spoken={second.aria} /> : <span>{second.value}</span>}
                </>
              )}
            </span>
          </div>
        </div>
        {why}
        {facts}
        {info}
        {cta}
      </section>
    );
  }

  // Neutraler Platz (z. B. Spiele im Ausland): kein echtes Heimteam. Gross nur der Teamname, klein Gast und
  // nominell Heim. Der Ort mit dem Hinweis neutraler Platz steht in den Fakten
  const sideText = (home: boolean) => (game.neutralSite ? (home ? "nominell Heim" : "Gast") : home ? "Heim" : "Auswärts");
  const teamBlock = (t: Team, score: number | null | undefined, home: boolean) => (
    <div className={home ? "hero-team hero-team-home" : "hero-team"}>
      <TeamLogo team={t} size={big ? 56 : 40} className="hero-logo" />
      <span className="hero-abbr">{t.abbr}</span>
      <span className="hero-score" aria-hidden={score === undefined ? "true" : undefined}>
        {score ?? "\u00a0"}
      </span>
      <span className="hero-sub">{big ? (game.neutralSite ? t.shortName : `${t.shortName} · ${sideText(home)}`) : sideText(home)}</span>
    </div>
  );
  const teams = (
    <div className="hero-teams">
      {teamBlock(away, scores ? scores[0] : undefined, false)}
      {ring}
      {teamBlock(home, scores ? scores[1] : undefined, true)}
    </div>
  );
  const fields = (
    <div className={`hero-fields${second ? "" : " hero-fields-single"}`}>
      <div>
        <span className="hero-label">Tipp</span>
        <span className="hero-value">{tipText}</span>
      </div>
      {second && (
        <div>
          <span className="hero-label">{second.label}</span>
          {second.aria ? (
            <Spoken className="hero-value" shown={second.value} spoken={second.aria} />
          ) : (
            <span className="hero-value">{second.value}</span>
          )}
        </div>
      )}
    </div>
  );

  if (layout === "medium") {
    return (
      <section className="hero hero-split" style={style} aria-label={sectionLabel}>
        {nav && <div className="hero-split-nav">{nav}</div>}
        <div className="hero-col">
          {head}
          {teams}
        </div>
        <div className="hero-col">
          {fields}
          {why}
          {facts}
          {info}
          {cta}
        </div>
      </section>
    );
  }

  return (
    <section className={`hero${big ? " hero-big" : ""}`} style={style} aria-label={sectionLabel}>
      {nav}
      {head}
      {teams}
      {fields}
      {why}
      {facts}
      {info}
      {cta}
    </section>
  );
}
