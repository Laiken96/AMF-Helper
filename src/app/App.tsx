import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game, Team } from "../core/schema";
import { groupBySlot } from "../core/time";
import { LoadError, loadWeekData, type WeekData } from "./data";
import { markOnboardingSeen, onboardingSeen, registerServiceWorker } from "./push";
import { ReviewView } from "./ReviewView";
import { Onboarding, SettingsView } from "./SettingsView";
import { TipsView } from "./TipsView";
import { LoadErrorNotice, TeamBadge, fallbackTeam, fetchedFormat } from "./ui";

type View = "tipps" | "bilanz" | "spielplan" | "einstellungen";

function viewFromHash(): View {
  if (window.location.hash === "#bilanz") return "bilanz";
  if (window.location.hash === "#spielplan") return "spielplan";
  if (window.location.hash === "#einstellungen") return "einstellungen";
  return "tipps";
}

const NAV: { view: View; label: string }[] = [
  { view: "tipps", label: "Tipps" },
  { view: "bilanz", label: "Bilanz" },
  { view: "spielplan", label: "Spielplan" },
  { view: "einstellungen", label: "Einstellungen" },
];

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [showOnboarding, setShowOnboarding] = useState(() => !onboardingSeen());

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  const closeOnboarding = useCallback(() => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  return (
    <>
      <nav className="nav" aria-label="Ansicht">
        <div className="nav-inner">
          {NAV.map((item) => (
            <a
              key={item.view}
              href={`#${item.view}`}
              className={view === item.view ? "active" : undefined}
              aria-current={view === item.view ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>
      <main className="page">
        {view === "tipps" && <TipsView />}
        {view === "bilanz" && <ReviewView />}
        {view === "spielplan" && <ScheduleView />}
        {view === "einstellungen" && <SettingsView onShowOnboarding={() => setShowOnboarding(true)} />}
      </main>
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}
    </>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: WeekData };

const STATUS_TEXT: Record<Game["status"], string> = {
  scheduled: "Geplant",
  in_progress: "Läuft",
  final: "Final",
  postponed: "Verschoben",
  canceled: "Abgesagt",
};

function ScheduleView() {
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

  if (state.kind === "loading") return <p className="notice">Daten werden geladen …</p>;
  if (state.kind === "error") return <LoadErrorNotice message={state.message} />;
  return <WeekView data={state.data} />;
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
