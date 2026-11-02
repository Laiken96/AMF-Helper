import { useEffect, useMemo, useState } from "react";
import type { Game, Team } from "../core/schema";
import { groupBySlot } from "../core/time";
import { LoadError, loadWeekData, type WeekData } from "./data";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: WeekData };

const fetchedFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_TEXT: Record<Game["status"], string> = {
  scheduled: "Geplant",
  in_progress: "Läuft",
  final: "Final",
  postponed: "Verschoben",
  canceled: "Abgesagt",
};

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    loadWeekData()
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

  return (
    <main className="page">
      {state.kind === "loading" && <p className="notice">Daten werden geladen …</p>}
      {state.kind === "error" && (
        <div className="notice notice-error" role="alert">
          <strong>Daten konnten nicht geladen werden.</strong>
          <p>{state.message}</p>
        </div>
      )}
      {state.kind === "ready" && <WeekView data={state.data} />}
    </main>
  );
}

function WeekView({ data }: { data: WeekData }) {
  const { week, teams } = data;
  const teamById = useMemo(() => new Map(teams.teams.map((t) => [t.id, t])), [teams]);
  const slots = useMemo(() => groupBySlot(week.games), [week.games]);
  const byeTeams = week.byeTeamIds.map((id) => teamById.get(id) ?? fallbackTeam(id));

  return (
    <>
      <header className="header">
        <h1>Week {week.week}</h1>
        <p className="meta">
          Saison {week.season} · Letzte Änderung {fetchedFormat.format(new Date(week.fetchedAt))}
        </p>
      </header>

      {week.games.length === 0 ? (
        <p className="notice">Diese Woche sind keine Spiele angesetzt.</p>
      ) : (
        slots.map((slot) => (
          <section key={slot.slotKey} className="slot">
            <h2>{slot.label}</h2>
            <ul className="games">
              {slot.games.map((game) => (
                <GameRow key={game.id} game={game} teamById={teamById} />
              ))}
            </ul>
          </section>
        ))
      )}

      {byeTeams.length > 0 && (
        <section className="slot">
          <h2>Spielfrei</h2>
          <ul className="byes">
            {byeTeams.map((team) => (
              <li key={team.id}>
                <TeamBadge team={team} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function GameRow({ game, teamById }: { game: Game; teamById: Map<string, Team> }) {
  const away = teamById.get(game.awayId) ?? fallbackTeam(game.awayId);
  const home = teamById.get(game.homeId) ?? fallbackTeam(game.homeId);
  const showScore =
    (game.status === "in_progress" || game.status === "final") &&
    game.awayScore !== null &&
    game.homeScore !== null;

  return (
    <li className={`game status-${game.status}`}>
      <div className="matchup">
        <TeamBadge team={away} />
        {showScore ? (
          <span className="score">
            {game.awayScore} : {game.homeScore}
          </span>
        ) : (
          <span className="at">@</span>
        )}
        <TeamBadge team={home} />
      </div>
      <div className="details">
        <span>{game.venue ?? ""}</span>
        <span className="status">
          {game.status === "scheduled" ? STATUS_TEXT.scheduled : game.statusDetail || STATUS_TEXT[game.status]}
        </span>
      </div>
    </li>
  );
}

function TeamBadge({ team }: { team: Team }) {
  return (
    <span className="team" title={team.name}>
      {team.logo ? (
        <img src={team.logo} alt="" width={28} height={28} loading="lazy" />
      ) : (
        <span className="logo-placeholder" aria-hidden="true" />
      )}
      <span className="abbr">{team.abbr}</span>
    </span>
  );
}

function fallbackTeam(id: string): Team {
  return { id, abbr: `#${id}`, name: `Team ${id}`, shortName: `Team ${id}`, logo: null, color: null };
}
