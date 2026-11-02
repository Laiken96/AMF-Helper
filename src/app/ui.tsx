import type { Team } from "../core/schema";

export const fetchedFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function TeamBadge({ team }: { team: Team }) {
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

export function fallbackTeam(id: string): Team {
  return { id, abbr: `#${id}`, name: `Team ${id}`, shortName: `Team ${id}`, logo: null, color: null };
}

export function LoadErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice notice-error" role="alert">
      <strong>Daten konnten nicht geladen werden.</strong>
      <p>{message}</p>
    </div>
  );
}
