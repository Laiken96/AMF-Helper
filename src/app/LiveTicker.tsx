// Liveticker als Zentrum im Reiter Spiele (D054): grosse Karte pro laufendem Spiel, mehrere waagrecht wischbar.
// Jeder Block erscheint nur mit Daten. Kopf und Siegchance immer offen, die übrigen Blöcke im iPhone klappbar.
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { Game, Team } from "../core/schema";
import type { GameTip } from "../core/tips-schema";
import { SURFACE_DARK, SURFACE_LIGHT, shadeForText, teamColor, visibleOn } from "./colors";
import { useLayoutValue } from "./layout";
import { periodText, type LiveGame, type SummaryState } from "./live";
import {
  fieldPosition,
  tipStanding,
  winSeries,
  type Leader,
  type LeaderCategory,
  type LiveSummary,
  type StatRow,
} from "./live-summary";
import { TeamLogo, usePrefersLight } from "./ui";
import { statusWord } from "./wording";

const clockFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// ---------- Klappbare Blöcke, Wahl im localStorage ----------

const OPEN_KEY = "nfl-ticker-open";
export type SectionId = "plays" | "scoring" | "stats" | "info";
const DEFAULT_OPEN: Record<SectionId, boolean> = { plays: true, scoring: true, stats: false, info: false };

function readOpen(): Partial<Record<SectionId, boolean>> {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Partial<Record<SectionId, boolean>>) : {};
  } catch {
    return {};
  }
}

function writeOpen(value: Partial<Record<SectionId, boolean>>): void {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // Ohne Speicher gilt die Wahl bis zum Neuladen
  }
}

/** Offen Zustand aller Blöcke, geteilt über alle Ticker Karten. */
function useOpenSections(): [(id: SectionId) => boolean, (id: SectionId) => void] {
  const [stored, setStored] = useState(readOpen);
  const isOpen = useCallback((id: SectionId) => stored[id] ?? DEFAULT_OPEN[id], [stored]);
  const toggle = useCallback(
    (id: SectionId) =>
      setStored((s) => {
        const next = { ...s, [id]: !(s[id] ?? DEFAULT_OPEN[id]) };
        writeOpen(next);
        return next;
      }),
    [],
  );
  return [isOpen, toggle];
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? "tk-chevron tk-chevron-open" : "tk-chevron"}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Block im Körper des Tickers, im iPhone klappbar. Auch in der Spielansicht (D056) genutzt. */
export function Block({
  id,
  title,
  collapsible,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  collapsible: boolean;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  if (!collapsible) {
    return (
      <section className="tk-block" aria-label={title}>
        <h2 className="tk-h2">{title}</h2>
        {children}
      </section>
    );
  }
  return (
    <section className="tk-block" aria-label={title}>
      <h2 className="tk-h2">
        <button type="button" className="tk-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)}>
          <span>{title}</span>
          <Chevron open={open} />
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}

// ---------- Kopf ----------

export const Football = () => (
  <svg className="tk-ball" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
    <ellipse cx="9" cy="6" rx="8.5" ry="5.5" fill="#9a5b2a" stroke="#fff" strokeWidth="1" />
    <path d="M5.5 6h7M7 4.6v2.8M9 4.6v2.8M11 4.6v2.8" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const periodName = (i: number) => (i < 4 ? String(i + 1) : i === 4 ? "OT" : `OT${i - 3}`);

/** Punkte je Viertel, period markiert das laufende Viertel (null bei beendeten Spielen). */
export function LineScore({
  away,
  home,
  awayLines,
  homeLines,
  awayTotal,
  homeTotal,
  period,
}: {
  away: Team;
  home: Team;
  awayLines: (number | null)[];
  homeLines: (number | null)[];
  awayTotal: number | null;
  homeTotal: number | null;
  period: number | null;
}) {
  const count = Math.max(4, awayLines.length, homeLines.length);
  if (awayLines.length === 0 && homeLines.length === 0) return null;
  const cols = Array.from({ length: count }, (_, i) => i);
  const cell = (lines: (number | null)[], i: number) => {
    const v = lines[i];
    return v === null || v === undefined ? (period !== null && i < period ? "0" : "") : String(v);
  };
  return (
    <table className="tk-lines">
      <caption className="sr-only">Punkte je Viertel</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">Team</span>
          </th>
          {cols.map((i) => (
            <th key={i} scope="col" className={period === i + 1 ? "tk-now" : undefined}>
              {periodName(i)}
            </th>
          ))}
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {(
          [
            [away, awayLines, awayTotal],
            [home, homeLines, homeTotal],
          ] as const
        ).map(([t, lines, total]) => (
          <tr key={t.id}>
            <th scope="row">{t.abbr}</th>
            {cols.map((i) => (
              <td key={i}>{cell([...lines], i)}</td>
            ))}
            <td className="tk-total">{total ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldBar({ live, away, home }: { live: LiveGame; away: Team; home: Team }) {
  const pos = fieldPosition({
    fieldText: live.extra?.fieldText,
    yardLine: live.extra?.yardLine,
    possessionTeamId: live.possessionTeamId,
    redZone: live.redZone,
    home,
    away,
  });
  if (!pos) return null;
  // Rote Zone: die 20 Yards vor der angegriffenen Endzone
  const zone = pos.dir === "left" ? { left: 0, width: 20 } : pos.dir === "right" ? { left: 80, width: 20 } : null;
  const dist = live.extra?.distance ?? null;
  const toGain =
    pos.dir && dist !== null && dist > 0 && (pos.toGo === null || dist < pos.toGo)
      ? pos.dir === "left"
        ? pos.x - dist
        : pos.x + dist
      : null;
  const ezStyle = (t: Team): CSSProperties => ({ background: shadeForText(teamColor(t.color)) });
  return (
    <div className="tk-field" role="img" aria-label={pos.spoken}>
      <span className="tk-ez" style={ezStyle(away)} aria-hidden="true">
        {away.abbr}
      </span>
      <div className="tk-grass" aria-hidden="true">
        {zone && (
          <span className={pos.redZone ? "tk-rz tk-rz-on" : "tk-rz"} style={{ left: `${zone.left}%`, width: `${zone.width}%` }}>
            {pos.redZone && <span className="tk-rz-label">Red Zone</span>}
          </span>
        )}
        <span className="tk-mid" />
        {toGain !== null && toGain > 0 && toGain < 100 && <span className="tk-gain" style={{ left: `${toGain}%` }} />}
        <span className={`tk-ballpos${pos.dir ? ` tk-dir-${pos.dir}` : ""}`} style={{ left: `${pos.x}%` }}>
          <Football />
        </span>
      </div>
      <span className="tk-ez" style={ezStyle(home)} aria-hidden="true">
        {home.abbr}
      </span>
    </div>
  );
}

/** Teamfarben Verlauf des Kopfs, gleich im Ticker und in der Spielansicht. */
export const headStyle = (away: Team, home: Team): CSSProperties =>
  ({ "--hero-a": shadeForText(teamColor(away.color)), "--hero-b": shadeForText(teamColor(home.color)) }) as CSSProperties;

function Head({
  live,
  summary,
  away,
  home,
}: {
  live: LiveGame;
  summary: LiveSummary | null;
  away: Team;
  home: Team;
}) {
  const sTeam = (id: string) => summary?.teams.find((t) => t.id === id);
  const awayRecord = sTeam(away.id)?.record ?? live.extra?.awayRecord ?? null;
  const homeRecord = sTeam(home.id)?.record ?? live.extra?.homeRecord ?? null;
  const awayLines = sTeam(away.id)?.lines.length ? sTeam(away.id)!.lines : (live.extra?.awayLines ?? []);
  const homeLines = sTeam(home.id)?.lines.length ? sTeam(home.id)!.lines : (live.extra?.homeLines ?? []);
  const poss = live.possessionTeamId === away.id ? away : live.possessionTeamId === home.id ? home : null;
  const tv = live.extra?.broadcast ?? (summary?.info.tv.length ? summary.info.tv.join(", ") : null);
  const team = (t: Team, score: number | null, record: string | null, side: "away" | "home") => (
    <div className={`tk-team tk-team-${side}`}>
      <TeamLogo team={t} size={56} className="tk-logo" onDark />
      <span className="tk-abbr">
        {side === "home" && poss?.id === t.id && <Football />}
        {t.abbr}
        {side === "away" && poss?.id === t.id && <Football />}
        {poss?.id === t.id && <span className="sr-only">, Ballbesitz</span>}
      </span>
      <span className="tk-name">{t.shortName}</span>
      {record && <span className="tk-record">Bilanz {record}</span>}
      <span className="tk-score" aria-hidden="true">
        {score ?? "–"}
      </span>
    </div>
  );
  const status = statusWord(periodText(live));
  const spoken =
    live.awayScore !== null && live.homeScore !== null
      ? `${away.abbr} ${live.awayScore} zu ${live.homeScore} ${home.abbr}`
      : `${away.abbr} gegen ${home.abbr}`;
  return (
    <div className="tk-head" style={headStyle(away, home)}>
      <div className="tk-top">
        <span className="tk-live">
          <span className="live-dot" aria-hidden="true" />
          <span className="sr-only">Läuft, </span>
          {status}
        </span>
        {tv && <span className="tk-tv">TV {tv}</span>}
      </div>
      <p className="sr-only">Spielstand {spoken}</p>
      <div className="tk-teams">
        {team(away, live.awayScore, awayRecord, "away")}
        <span className="tk-colon" aria-hidden="true">
          :
        </span>
        {team(home, live.homeScore, homeRecord, "home")}
      </div>
      {(poss || live.downDistance) && (
        <p className="tk-sit">
          {poss && <span>Ballbesitz {poss.abbr}</span>}
          {live.downDistance && <span className="tk-down">{live.downDistance}</span>}
          {live.redZone && <span className="tk-rz-tag">Red Zone</span>}
        </p>
      )}
      <FieldBar live={live} away={away} home={home} />
      <LineScore
        away={away}
        home={home}
        awayLines={awayLines}
        homeLines={homeLines}
        awayTotal={live.awayScore}
        homeTotal={live.homeScore}
        period={live.period}
      />
      {live.lastPlay && (
        <p className="tk-last">
          <span className="tk-last-label">Letzter Spielzug</span> {live.lastPlay}
        </p>
      )}
    </div>
  );
}

// ---------- Siegchance ----------

const pct = (v: number) => Math.round(v * 100);

function WinChart({ summary, away, home, tip }: { summary: LiveSummary; away: Team; home: Team; tip: GameTip | undefined }) {
  // useId enthält Doppelpunkte oder Klammern, in url(#...) nur Buchstaben und Ziffern
  const clipTop = `tk${useId().replace(/[^a-zA-Z0-9]/g, "")}t`;
  const clipBottom = `${clipTop}b`;
  // Kurve auf der Fläche des Blocks: dunkel oder im Hellmodus weiss
  const surface = usePrefersLight() ? SURFACE_LIGHT : SURFACE_DARK;
  const { span, points } = winSeries(summary.winProb);
  if (points.length === 0) return null;
  const W = 300;
  const H = 120;
  const xy = points.map((p) => [p.x * W, (1 - p.y) * H] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const lastXY = xy[xy.length - 1]!;
  const area = `${line} L${lastXY[0].toFixed(1)} ${H / 2} L${xy[0]![0].toFixed(1)} ${H / 2} Z`;
  const homePct = pct(last.y);
  const awayPct = 100 - homePct;
  const leader = homePct >= awayPct ? home : away;
  const quarters = [900, 1800, 2700, 3600].filter((t) => t < span).map((t) => (t / span) * W);
  const hasPick = tip && tip.pickTeamId && tip.level !== "offen" && tip.level !== "nicht_erfasst";
  const pick = hasPick ? (tip.pickTeamId === home.id ? home : tip.pickTeamId === away.id ? away : null) : null;
  const standing = pick ? tipStanding(last.y, pick.id, home.id) : null;
  const homeColor = visibleOn(teamColor(home.color), surface, 2);
  const awayColor = visibleOn(teamColor(away.color), surface, 2);
  return (
    <section className="tk-block tk-win" aria-label="Siegchance">
      <h2 className="tk-h2 tk-h2-static">Siegchance</h2>
      <p className="tk-win-now">
        <span className="tk-win-big">
          {leader.abbr} {Math.max(homePct, awayPct)} %
        </span>
        <span className="tk-win-small">
          {away.abbr} {awayPct} % · {home.abbr} {homePct} %
        </span>
      </p>
      {pick && standing && (
        <p className={`tk-tip tk-tip-${standing}`}>
          <span className="tk-tip-mark" aria-hidden="true">
            {standing === "vorne" ? "▲" : standing === "hinten" ? "▼" : "◆"}
          </span>
          {standing === "gleich" ? `Dein Tipp ${pick.abbr} liegt gleichauf` : `Dein Tipp ${pick.abbr} liegt ${standing}`}
        </p>
      )}
      <div className="tk-chart">
        <span className="tk-chart-label tk-chart-top" aria-hidden="true">
          {home.abbr}
        </span>
        <span className="tk-chart-label tk-chart-bottom" aria-hidden="true">
          {away.abbr}
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Verlauf der Siegchance über ${points.length} Spielzüge, aktuell ${home.abbr} ${homePct} Prozent, ${away.abbr} ${awayPct} Prozent`}
        >
          <defs>
            <clipPath id={clipTop}>
              <rect x="0" y="0" width={W} height={H / 2} />
            </clipPath>
            <clipPath id={clipBottom}>
              <rect x="0" y={H / 2} width={W} height={H / 2} />
            </clipPath>
          </defs>
          {quarters.map((x) => (
            <line key={x} x1={x} x2={x} y1="0" y2={H} className="tk-grid" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill={homeColor} opacity="0.35" clipPath={`url(#${clipTop})`} />
          <path d={area} fill={awayColor} opacity="0.35" clipPath={`url(#${clipBottom})`} />
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="tk-axis" vectorEffect="non-scaling-stroke" />
          <path d={line} className="tk-line" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="tk-chart-dot" style={{ left: `${(lastXY[0] / W) * 100}%`, top: `${(lastXY[1] / H) * 100}%` }} aria-hidden="true" />
        <span className="tk-chart-mid" aria-hidden="true">
          50 %
        </span>
      </div>
      <div className="tk-chart-q" aria-hidden="true">
        {["Q1", "Q2", "Q3", "Q4"].map((q) => (
          <span key={q}>{q}</span>
        ))}
      </div>
    </section>
  );
}

// ---------- Spielzüge, Punkte, Statistik, Info ----------

const qText = (p: number | null) => (p ? (p > 4 ? (p === 5 ? "OT" : `OT${p - 4}`) : `Q${p}`) : "");

function Plays({ summary, team }: { summary: LiveSummary; team: (id: string) => Team }) {
  const d = summary.drive;
  return (
    <>
      {d && (d.plays !== null || d.yards !== null) && (
        <div className="tk-drive">
          <span className="tk-drive-label">Aktueller Drive{d.teamId ? ` ${team(d.teamId).abbr}` : ""}</span>
          <dl className="tk-drive-nums">
            {d.plays !== null && (
              <div>
                <dt>Spielzüge</dt>
                <dd>{d.plays}</dd>
              </div>
            )}
            {d.yards !== null && (
              <div>
                <dt>Yards</dt>
                <dd>{d.yards}</dd>
              </div>
            )}
            {d.time && (
              <div>
                <dt>Zeit</dt>
                <dd>{d.time}</dd>
              </div>
            )}
            {d.start && (
              <div>
                <dt>Start</dt>
                <dd>{d.start}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {summary.plays.length === 0 ? (
        <p className="tk-hint">Noch keine Spielzüge.</p>
      ) : (
        <ol className="plays" aria-label="Letzte Spielzüge, neueste zuerst">
          {summary.plays.map((p) => (
            <li key={p.id} className={p.scoring ? "play play-score" : "play"}>
              <span className="play-when">
                {qText(p.period)} {p.clock ?? ""}
                {p.teamId && <span className="play-team"> {team(p.teamId).abbr}</span>}
                {p.scoring && <span className="play-tag"> Punkte</span>}
              </span>
              <span className="play-text">{p.text}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function Scoring({ summary, team, away, home }: { summary: LiveSummary; team: (id: string) => Team; away: Team; home: Team }) {
  return (
    <ol className="tk-scoring">
      {summary.scoring.map((p) => (
        <li key={p.id}>
          <span className="tk-sc-when">
            {qText(p.period)} {p.clock ?? ""}
          </span>
          <span className="tk-sc-team">
            {p.teamId ? team(p.teamId).abbr : ""} {p.type ?? ""}
          </span>
          {p.awayScore !== null && p.homeScore !== null && (
            <span className="tk-sc-score">
              <span aria-hidden="true">
                {p.awayScore} : {p.homeScore}
              </span>
              <span className="sr-only">
                {away.abbr} {p.awayScore} zu {p.homeScore} {home.abbr}
              </span>
            </span>
          )}
          <span className="tk-sc-text">{p.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function StatBars({ rows, away, home }: { rows: StatRow[]; away: Team; home: Team }) {
  const surface = usePrefersLight() ? SURFACE_LIGHT : SURFACE_DARK;
  const awayColor = visibleOn(teamColor(away.color), surface, 1.6);
  const homeColor = visibleOn(teamColor(home.color), surface, 1.6);
  return (
    <div className="tk-stats">
      <div className="tk-stats-head" aria-hidden="true">
        <span>{away.abbr}</span>
        <span>{home.abbr}</span>
      </div>
      <dl className="tk-stat-list">
        {rows.map((r) => {
          const max = Math.max(r.away.value, r.home.value);
          const w = (v: number) => (max > 0 ? `${Math.max(2, (v / max) * 100)}%` : "2%");
          return (
            <div key={r.key} className="tk-stat">
              <dt>{r.label}</dt>
              <dd>
                <span className="tk-stat-val tk-stat-away">
                  <span className="sr-only">{away.abbr} </span>
                  {r.away.display}
                </span>
                <span className="tk-bars" aria-hidden="true">
                  <span className="tk-bar tk-bar-away">
                    <span style={{ width: w(r.away.value), background: awayColor }} />
                  </span>
                  <span className="tk-bar tk-bar-home">
                    <span style={{ width: w(r.home.value), background: homeColor }} />
                  </span>
                </span>
                <span className="tk-stat-val tk-stat-home">
                  <span className="sr-only">{home.abbr} </span>
                  {r.home.display}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

const CATEGORY_TEXT: Record<LeaderCategory, string> = { pass: "Pass", rush: "Lauf", rec: "Fang" };

export function Leaders({ leaders, away, home }: { leaders: Leader[]; away: Team; home: Team }) {
  const cats = (["pass", "rush", "rec"] as const).filter((c) => leaders.some((l) => l.category === c));
  if (cats.length === 0) return null;
  const cell = (c: LeaderCategory, t: Team) => {
    const l = leaders.find((x) => x.category === c && x.teamId === t.id);
    return l ? (
      <>
        <span className="tk-ld-name">
          <span className="sr-only">{t.abbr} </span>
          {l.name}
        </span>
        <span className="tk-ld-val">{l.display}</span>
      </>
    ) : (
      <span className="tk-ld-val">
        <span className="sr-only">{t.abbr} </span>keine Angabe
      </span>
    );
  };
  return (
    <div className="tk-leaders">
      <h3 className="tk-h3">Top Spieler</h3>
      <dl>
        {cats.map((c) => (
          <div key={c} className="tk-ld">
            <dt>{CATEGORY_TEXT[c]}</dt>
            <dd className="tk-ld-away">{cell(c, away)}</dd>
            <dd className="tk-ld-home">{cell(c, home)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Info({ summary, live }: { summary: LiveSummary | null; live: LiveGame }) {
  const info = summary?.info;
  const tv = info?.tv.length ? info.tv.join(", ") : (live.extra?.broadcast ?? null);
  const weather =
    info && (info.tempC !== null || info.weather)
      ? [info.tempC !== null ? `${info.tempC} °C` : null, info.weather].filter(Boolean).join(", ")
      : info?.indoor
        ? "Halle"
        : null;
  const place = info?.venue ? [info.venue, info.city].filter(Boolean).join(", ") : null;
  if (!place && !weather && !tv) return null;
  return (
    <dl className="game-facts">
      {place && (
        <div>
          <dt>Ort</dt>
          <dd>{place}</dd>
        </div>
      )}
      {weather && (
        <div>
          <dt>Wetter</dt>
          <dd>{weather}</dd>
        </div>
      )}
      {tv && (
        <div>
          <dt>TV</dt>
          <dd>{tv}</dd>
        </div>
      )}
    </dl>
  );
}

// ---------- Karte ----------

export interface TickerProps {
  game: Game;
  live: LiveGame;
  summary: SummaryState | undefined;
  tip: GameTip | undefined;
  team: (id: string) => Team;
  tipsHref: string;
}

/** Ticker eines laufenden Spiels. */
export function LiveTicker({ game, live, summary, tip, team, tipsHref }: TickerProps) {
  const layout = useLayoutValue();
  const collapsible = layout !== "wide";
  const [isOpen, toggle] = useOpenSections();
  const away = team(game.awayId);
  const home = team(game.homeId);
  const s = summary?.summary ?? null;
  const hasInfo = Boolean(s?.info.venue || (s != null && s.info.tempC !== null) || s?.info.tv.length || live.extra?.broadcast);
  const block = (id: SectionId, title: string, content: ReactNode) => (
    <Block id={id} title={title} collapsible={collapsible} open={!collapsible || isOpen(id)} onToggle={toggle}>
      {content}
    </Block>
  );
  return (
    <article className="ticker" aria-label={`Liveticker ${away.abbr} @ ${home.abbr}`}>
      <Head live={live} summary={s} away={away} home={home} />
      <div className="tk-body">
        {summary?.error && (
          <p className="tk-hint" role="status">
            Spieldaten gerade nicht erreichbar.{" "}
            {summary.updatedAt ? `Stand ${clockFormat.format(summary.updatedAt)}.` : "Neuer Versuch folgt."}
          </p>
        )}
        {!s && !summary?.error && <p className="tk-hint">Spieldaten werden geladen …</p>}
        {s && <WinChart summary={s} away={away} home={home} tip={tip} />}
        {s && (s.plays.length > 0 || s.drive) && block("plays", "Spielzüge", <Plays summary={s} team={team} />)}
        {s && s.scoring.length > 0 && block("scoring", "Punkte", <Scoring summary={s} team={team} away={away} home={home} />)}
        {s && (s.stats.length > 0 || s.leaders.length > 0) &&
          block(
            "stats",
            "Statistik",
            <>
              {s.stats.length > 0 && <StatBars rows={s.stats} away={away} home={home} />}
              <Leaders leaders={s.leaders} away={away} home={home} />
            </>,
          )}
        {hasInfo && block("info", "Ort, Wetter, TV", <Info summary={s} live={live} />)}
        {tip && tip.level !== "nicht_erfasst" && (
          <a className="btn game-detail-link" href={tipsHref}>
            Zur Tippseite
          </a>
        )}
      </div>
    </article>
  );
}

// ---------- Mehrere laufende Spiele ----------

const Arrow = ({ dir }: { dir: "left" | "right" }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

/**
 * Laufende Spiele als waagrecht wischbare Karten (CSS scroll snap). Punkte und Pfeile zeigen und wechseln
 * die Karte, Pfeiltasten im fokussierten Bereich ebenso. activeId steuert, welche Karte Summary Daten lädt.
 */
export function LiveCarousel({
  items,
  activeId,
  onActive,
  render,
}: {
  items: { id: string; label: string }[];
  activeId: string | null;
  onActive: (id: string) => void;
  render: (id: string) => ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const index = Math.max(0, items.findIndex((i) => i.id === activeId));
  const many = items.length > 1;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const scrollTo = useCallback(
    (i: number, smooth = true) => {
      const el = track.current;
      if (!el) return;
      el.scrollTo({ left: i * el.clientWidth, behavior: smooth && !reduced ? "smooth" : "auto" });
    },
    [reduced],
  );

  // Gewählte Karte von aussen (Hash, Liste) in den Blick holen
  useEffect(() => {
    const el = track.current;
    if (!el || !many) return;
    if (Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) !== index) scrollTo(index, false);
    // nur bei geänderter Wahl, nicht bei jedem Scrollen
  }, [index, many, scrollTo]);

  // Höhe der Spur folgt der sichtbaren Karte, sonst bliebe unter kurzen Karten die Höhe der längsten frei
  useEffect(() => {
    const el = track.current;
    const slide = el?.children[index] as HTMLElement | undefined;
    if (!el || !slide || !many || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      el.style.height = `${slide.offsetHeight}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(slide);
    return () => ro.disconnect();
  }, [index, many]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    const item = items[i];
    if (item && item.id !== activeId) onActive(item.id);
  };

  const go = (i: number) => {
    const target = Math.min(items.length - 1, Math.max(0, i));
    const item = items[target];
    if (!item) return;
    onActive(item.id);
    scrollTo(target);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    }
  };

  if (!many) {
    const only = items[0];
    return only ? <div className="tk-single">{render(only.id)}</div> : null;
  }

  return (
    <section className="tk-carousel" aria-roledescription="Karussell" aria-label="Laufende Spiele">
      <div className="tk-carousel-nav">
        <button type="button" className="tk-arrow" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Vorheriges laufendes Spiel">
          <Arrow dir="left" />
        </button>
        {/* Ab 6 Spielen nur der Zähler, sonst würden die Punkte umbrechen */}
        {items.length < 6 && (
        <div className="tk-dots" role="group" aria-label="Spiel wählen">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={i === index ? "tk-dot tk-dot-on" : "tk-dot"}
              aria-current={i === index ? "true" : undefined}
              aria-label={`${it.label}, Spiel ${i + 1} von ${items.length}`}
              onClick={() => go(i)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
        )}
        <span className="tk-count" aria-live="polite">
          {index + 1} von {items.length}
        </span>
        <button
          type="button"
          className="tk-arrow"
          onClick={() => go(index + 1)}
          disabled={index === items.length - 1}
          aria-label="Nächstes laufendes Spiel"
        >
          <Arrow dir="right" />
        </button>
      </div>
      <div
        ref={track}
        className="tk-track"
        role="region"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKey}
        aria-label="Laufende Spiele, mit Pfeiltasten wechseln"
      >
        {items.map((it, i) => (
          <div
            key={it.id}
            className="tk-slide"
            role="group"
            aria-roledescription="Karte"
            aria-label={`${it.label}, ${i + 1} von ${items.length}`}
            aria-hidden={i === index ? undefined : true}
            inert={i === index ? undefined : true}
          >
            {render(it.id)}
          </div>
        ))}
      </div>
    </section>
  );
}
