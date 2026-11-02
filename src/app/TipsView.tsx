import { useEffect, useMemo, useState } from "react";
import type { Game, Team } from "../core/schema";
import type { GameTip, StandingsFile, TipsFile } from "../core/tips-schema";
import { formatKickoffZurich, groupBySlot } from "../core/time";
import { LoadError, loadTipsData, type TipsData } from "./data";
import { LoadErrorNotice, TeamBadge, fallbackTeam, fetchedFormat } from "./ui";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TipsData };

const LEVEL_TEXT: Record<GameTip["level"], string> = {
  klar: "klar",
  favorit: "Favorit",
  unklar: "unklar",
  offen: "offen",
};

// Häkchen "eingetragen" nur lokal (Sprint 2). Jeder Storage Zugriff ist ausfalltolerant.
function storageKey(season: number, seasonType: number, week: number, gameId: string): string {
  return `nfl-dashboard:eingetragen:${season}-${seasonType}-${String(week).padStart(2, "0")}:${gameId}`;
}

function readChecked(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeChecked(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Ohne Storage bleibt das Häkchen nur bis zum Neuladen erhalten.
  }
}

export function TipsView() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    loadTipsData()
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
  }, []);

  if (state.kind === "loading") return <p className="notice">Daten werden geladen …</p>;
  if (state.kind === "error") return <LoadErrorNotice message={state.message} />;
  const { data } = state;
  if (!data.tips) {
    return (
      <>
        <header className="header">
          <h1>Week {data.current.week} Tipps</h1>
        </header>
        <StandingsBox standings={data.standings} maxDeviations={null} />
        <p className="notice">Für diese Woche gibt es noch keine Tipps.</p>
      </>
    );
  }
  return <TipsList data={data} tips={data.tips} />;
}

interface TipRow extends GameTip {
  id: string;
  game: Game | undefined;
  tiebreaker: boolean;
}

function TipsList({ data, tips }: { data: TipsData; tips: TipsFile }) {
  const teamById = useMemo(() => new Map(data.teams.teams.map((t) => [t.id, t])), [data.teams]);
  const gameById = useMemo(() => new Map(data.week.games.map((g) => [g.id, g])), [data.week]);
  const rows: TipRow[] = useMemo(
    () => tips.tips.map((t) => ({
        ...t,
        id: t.gameId,
        game: gameById.get(t.gameId),
        tiebreaker: tips.tiebreakers.some((tb) => tb.gameId === t.gameId),
      })),
    [tips, gameById],
  );
  const slots = useMemo(() => groupBySlot(rows), [rows]);

  const keyFor = (gameId: string) => storageKey(tips.season, tips.seasonType, tips.week, gameId);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(tips.tips.filter((t) => readChecked(keyFor(t.gameId))).map((t) => t.gameId)),
  );

  const toggle = (gameId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const value = !next.has(gameId);
      if (value) next.add(gameId);
      else next.delete(gameId);
      writeChecked(keyFor(gameId), value);
      return next;
    });
  };

  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const doneCount = rows.filter((r) => checked.has(r.gameId)).length;
  const openCount = rows.filter((r) => !checked.has(r.gameId) && !r.locked).length;

  return (
    <>
      <header className="header">
        <h1>Week {tips.week} Tipps</h1>
        <p className="meta">Letzte Aktualisierung {fetchedFormat.format(new Date(tips.updatedAt))}</p>
      </header>

      <div className="boxes">
        <TiebreakerBox tips={tips} gameById={gameById} team={team} />
        <StandingsBox standings={data.standings} maxDeviations={tips.maxDeviations} />
      </div>

      {rows.length === 0 ? (
        <p className="notice">Diese Woche sind keine Spiele angesetzt.</p>
      ) : (
        slots.map((slot) => (
          <section key={slot.slotKey} className="slot">
            <h2>{slot.label}</h2>
            <ul className="tips">
              {slot.games.map((row) => (
                <TipItem
                  key={row.gameId}
                  row={row}
                  team={team}
                  checked={checked.has(row.gameId)}
                  onToggle={() => toggle(row.gameId)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {rows.length > 0 && (
        <p className={`counter${openCount > 0 ? " counter-open" : ""}`} aria-live="polite">
          {doneCount} von {rows.length} Spielen eingetragen
          {openCount > 0 && <span> · {openCount} offen</span>}
        </p>
      )}
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
                  ? `${team(game.awayId).abbr} ${tb.awayPoints} : ${tb.homePoints} ${team(game.homeId).abbr}`
                  : `${tb.awayPoints} : ${tb.homePoints}`}
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
  const top = players[0]?.points ?? 0;
  const mine = players.find((p) => p.id === standings.me);
  const gap = mine ? top - mine.points : null;
  return (
    <section className="box" aria-label="Rangliste">
      <h2>Rangliste nach Week {standings.asOfWeek}</h2>
      <ol className="ranking">
        {players.map((p) => (
          <li key={p.id} className={p.id === standings.me ? "me" : undefined}>
            <span>{p.id}</span>
            <span className="pts">{p.points}</span>
          </li>
        ))}
      </ol>
      {gap !== null && (
        <p className="box-meta">{gap === 0 ? "Du führst die Rangliste" : `Rückstand auf Platz 1: ${gap} Punkte`}</p>
      )}
      {maxDeviations !== null && <p className="box-meta strong">Erlaubte Abweichungen diese Woche: {maxDeviations}</p>}
    </section>
  );
}

function TipItem({
  row,
  team,
  checked,
  onToggle,
}: {
  row: TipRow;
  team: (id: string) => Team;
  checked: boolean;
  onToggle: () => void;
}) {
  const { game } = row;
  const homeId = game?.homeId;
  const hasPick = row.level !== "offen" && row.pickTeamId !== null;
  const pickId = hasPick ? row.pickTeamId! : (game?.awayId ?? null);
  const otherId = game ? (pickId === game.homeId ? game.awayId : game.homeId) : null;
  const pick = pickId ? team(pickId) : null;
  const other = otherId ? team(otherId) : null;
  const pending = !checked && !row.locked;

  const classes = ["tip", `level-${row.level}`];
  if (pending) classes.push("pending");
  if (checked) classes.push("done");
  if (row.locked) classes.push("locked");

  return (
    <li className={classes.join(" ")}>
      <div className="tip-main">
        <div className="tip-teams">
          {pick ? (
            <span className={hasPick ? "pick" : "nopick"}>
              <TeamBadge team={pick} />
              {pick.id === homeId && <span className="home">(H)</span>}
            </span>
          ) : (
            <span className="nopick">Spiel {row.gameId}</span>
          )}
          {other && (
            <>
              <span className="vs">vs</span>
              <span className="opp">
                {other.abbr}
                {other.id === homeId && <span className="home">(H)</span>}
              </span>
            </>
          )}
        </div>
        <div className="tip-value">
          {hasPick && row.pickProb !== null ? (
            <span className="prob">{Math.round(row.pickProb * 100)} %</span>
          ) : (
            <span className="noodds">keine Quote</span>
          )}
          <span className={`level level-tag-${row.level}`}>{LEVEL_TEXT[row.level]}</span>
        </div>
      </div>
      <div className="tip-meta">
        <span className="flags">
          {row.tiebreaker && <span className="flag tb-flag">Resultat tippen</span>}
          {row.deviation && (
            <span className="flag" title="Bewusste Abweichung vom Favoriten">
              <span aria-hidden="true">🎯</span> Abweichung
            </span>
          )}
          {row.changedSinceFirst && <span className="flag changed">geändert seit Grundtipp</span>}
          {row.locked && (
            <span className="flag" title="Kickoff vorbei, Tipp gesperrt">
              <span aria-hidden="true">🔒</span> gesperrt
            </span>
          )}
        </span>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={onToggle} />
          eingetragen
        </label>
      </div>
    </li>
  );
}
