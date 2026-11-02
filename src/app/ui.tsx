import type { ReactNode } from "react";
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

/** Kopf jeder Ansicht: kleine Überzeile, grosser Titel in Barlow Condensed, Metazeile. */
export function PageHeader({ kicker, title, meta, aside }: { kicker?: string; title: string; meta?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="header">
      <div className="header-main">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1>{title}</h1>
      </div>
      {aside && <div className="header-aside">{aside}</div>}
      {meta && <p className="meta">{meta}</p>}
    </header>
  );
}

/** Umschalter als Kapsel mit zwei oder mehr Optionen. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "active" : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
