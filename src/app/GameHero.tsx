import { useEffect, useState, type CSSProperties } from "react";
import type { InjuriesFile, KeyPlayer } from "../core/injuries";
import type { Game, Team } from "../core/schema";
import type { GameTip, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich } from "../core/time";
import { shadeForText, teamColor, visibleOn } from "./colors";
import { useLayoutValue } from "./layout";
import { periodText, type LiveGame } from "./live";
import type { NewsFile } from "../core/extra-schema";

type NewsItem = NewsFile["items"][number];

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

function Headlines({ items }: { items: readonly NewsItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="hero-news" aria-label="Schlagzeilen zu diesem Spiel">
      {items.map((i) => (
        <li key={i.id}>
          <a href={i.url} target="_blank" rel="noopener noreferrer">
            {i.title}
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
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

/**
 * "3 T 21 h", "5 h 12 min" oder "12 min". Minuten werden aufgerundet: angezeigt wird nie weniger als die
 * echte Restzeit und höchstens 59 s mehr (59 s Rest ergibt "1 min", nicht "0 min").
 */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} T ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

const SLOT_NAME: Record<Tiebreaker["slot"], string> = { thursday: "Thursday Night", monday: "Monday Night" };
const SLOT_SHORT: Record<Tiebreaker["slot"], string> = { thursday: "TNF", monday: "MNF" };

const ROLE_WEIGHT: Record<KeyPlayer["roles"][number], number> = { passing: 4, rushing: 3, receiving: 3, qb: 1 };

/** Wichtigster Ausfall des Spiels: Schlüsselspieler mit Out vor Doubtful, Leader vor reinem QB Eintrag. */
export function keyAbsence(injuries: InjuriesFile | null, gameId: string): KeyPlayer | null {
  const game = injuries?.current.games.find((g) => g.gameId === gameId);
  if (!game) return null;
  let best: { p: KeyPlayer; score: number } | null = null;
  for (const p of game.players) {
    const s = (p.status ?? "").trim().toLowerCase();
    const sev = s === "out" ? 2 : s === "doubtful" ? 1 : 0;
    if (sev === 0) continue;
    const role = Math.max(...p.roles.map((r) => ROLE_WEIGHT[r]));
    const score = sev * 10 + role;
    if (!best || score > best.score) best = { p, score };
  }
  return best?.p ?? null;
}

function absenceText(p: KeyPlayer): string {
  const detail = [p.pos, p.status].filter(Boolean).join(", ");
  return (p.status ?? "").toLowerCase() === "out"
    ? `${p.teamAbbr} ohne ${p.name} (${detail})`
    : `${p.teamAbbr}: ${p.name} fraglich (${detail})`;
}

const CIRC = 2 * Math.PI * 56;

function Ring({
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

/** Spielbereich in Teamfarben für das Spiel mit dem nächsten offenen Tippschluss (D037, D038). */
/** Warum kein Spiel im Spielbereich steht: alles gesperrt oder offene Spiele ohne Spieldaten. */
export type HeroEmpty = "gesperrt" | "ohne_daten";

export function GameHero({
  target,
  empty = "gesperrt",
  team,
  injuries,
  now,
  live = null,
  next = null,
  headlines = [],
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
}) {
  const layout = useLayoutValue();

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
  const awayColor = teamColor(away.color);
  const homeColor = teamColor(home.color);
  const pickColor = pick ? visibleOn(teamColor(pick.color), "#1B2230", 3) : "#F5B83D";
  const otherColor = other ? visibleOn(teamColor(other.color), "#1B2230", 1.8) : "#3A414D";

  const style = {
    "--hero-a": shadeForText(awayColor),
    "--hero-b": shadeForText(homeColor),
  } as CSSProperties;

  const isLive = live?.state === "in";
  const countdown = formatCountdown(Date.parse(tip.kickoffUtc) - now);
  const liveScore = isLive ? `${live.awayScore ?? 0} : ${live.homeScore ?? 0}` : "";
  const liveBadge = isLive && (
    <span className="hero-countdown hero-live">
      <span className="live-dot" aria-hidden="true" />
      <span className="sr-only">Läuft, </span>
      {periodText(live)}
    </span>
  );
  const sectionLabel = isLive ? "Laufendes Spiel" : "Nächster Tippschluss";
  const nextLine = isLive && next && (
    <p className="hero-next">
      Nächster Tippschluss {next.matchup} in {formatCountdown(Date.parse(next.kickoffUtc) - now)}
    </p>
  );
  const ctaEl =
    isLive && !next ? (
      <a className="hero-cta" href="#spiele">
        Zum Liveticker
      </a>
    ) : (
      <a className="hero-cta" href={TIPPSPIEL_URL} target="_blank" rel="noopener noreferrer">
        Auf der Tippseite eintragen
      </a>
    );
  const when = formatKickoffZurich(tip.kickoffUtc).replace(/ (\d\d:\d\d)$/, " · $1");
  const slot = tiebreaker ? ` · ${layout === "compact" || layout === "side" ? SLOT_SHORT[tiebreaker.slot] : SLOT_NAME[tiebreaker.slot]}` : "";
  const absence = keyAbsence(injuries, game.id);
  const prob = hasPick ? tip.pickProb : null;
  const tipText = pick ? `${pick.abbr} gewinnt` : "offen";
  const result = tiebreaker ? `${tiebreaker.awayPoints} : ${tiebreaker.homePoints}` : null;

  if (layout === "side") {
    return (
      <section className="hero hero-small" style={style} aria-label={sectionLabel}>
        <div className="hero-top">
          <span className="hero-when">
            {when}
            {slot}
          </span>
          {liveBadge || (
            <span className="hero-countdown">
              <span className="sr-only">Tippschluss in </span>
              {countdown}
            </span>
          )}
        </div>
        <div className="hero-small-body">
          <Ring prob={prob} pick={pick} pickColor={pickColor} otherColor={otherColor} size={72} withLabel={false} />
          <div className="hero-small-text">
            <span className="hero-matchup">
              {isLive ? `${away.abbr} ${liveScore} ${home.abbr}` : `${away.abbr} @ ${home.abbr}`}
            </span>
            <span>
              Tipp {pick ? pick.abbr : "offen"}
              {result && ` · Resultat ${result}`}
            </span>
            {absence && !isLive && <span className="hero-sub">{absenceText(absence)}</span>}
          </div>
        </div>
        {nextLine}
        <Headlines items={headlines.slice(0, 1)} />
        {ctaEl}
      </section>
    );
  }

  const big = layout === "wide";
  const head = (
    <div className="hero-top">
      <span className="hero-when">
        {when}
        {slot}
      </span>
      {liveBadge || (layout !== "medium" && <span className="hero-countdown">Tippschluss {big ? "in " : ""}{countdown}</span>)}
    </div>
  );
  const teams = (
    <div className="hero-teams">
      <div className="hero-team">
        <span className="hero-abbr">{away.abbr}</span>
        {isLive && <span className="hero-score">{live.awayScore ?? 0}</span>}
        <span className="hero-sub">{big ? `${away.shortName} · Auswärts` : "Auswärts"}</span>
      </div>
      <Ring prob={prob} pick={pick} pickColor={pickColor} otherColor={otherColor} size={big ? 140 : layout === "medium" ? 104 : 112} withLabel />
      <div className="hero-team hero-team-home">
        <span className="hero-abbr">{home.abbr}</span>
        {isLive && <span className="hero-score">{live.homeScore ?? 0}</span>}
        <span className="hero-sub">{big ? `${home.shortName} · Heim` : "Heim"}</span>
      </div>
    </div>
  );
  const fields = (
    <div className={`hero-fields${result ? "" : " hero-fields-single"}`}>
      <div>
        <span className="hero-label">Tipp</span>
        <span className="hero-value">{tipText}</span>
      </div>
      {result && (
        <div>
          <span className="hero-label">{big ? "Resultat Tiebreaker" : "Resultat"}</span>
          <span className="hero-value">{result}</span>
        </div>
      )}
    </div>
  );
  const absenceLine = absence && !isLive && (
    <div className="hero-absence">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5B83D" strokeWidth="2" aria-hidden="true">
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <circle cx="12" cy="12" r="9" />
      </svg>
      <span>{absenceText(absence)}</span>
    </div>
  );
  const cta = (
    <>
      {nextLine}
      <Headlines items={headlines} />
      {ctaEl}
    </>
  );

  if (layout === "medium") {
    return (
      <section className="hero hero-split" style={style} aria-label={sectionLabel}>
        <div className="hero-col">
          {head}
          {teams}
        </div>
        <div className="hero-col">
          {liveBadge || <span className="hero-countdown hero-countdown-end">Tippschluss {countdown}</span>}
          {fields}
          {absenceLine}
          {cta}
        </div>
      </section>
    );
  }

  return (
    <section className={`hero${big ? " hero-big" : ""}`} style={style} aria-label={sectionLabel}>
      {head}
      {teams}
      {fields}
      {absenceLine}
      {cta}
    </section>
  );
}
