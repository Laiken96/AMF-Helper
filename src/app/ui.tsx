import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Team } from "../core/schema";
import { compareRef, retryLoad, sameRef, weekKey, type WeekPhase, type WeekRef } from "./data";

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

/**
 * Ladefehler mit Knopf Erneut versuchen. Der Knopf fragt fehlgeschlagene Dateien neu ab und lässt die Ansicht
 * neu laden. Gelingt der Abruf, ersetzt der Inhalt den Hinweis.
 */
export function LoadErrorNotice({ message, onRetry = retryLoad }: { message: string; onRetry?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retry = () => {
    setBusy(true);
    onRetry()
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };
  return (
    <div className="notice notice-error" role="alert">
      <strong>Daten konnten nicht geladen werden.</strong>
      <p>{message}</p>
      <div className="button-row notice-actions">
        <button type="button" className="btn" onClick={retry} disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Wird geladen …" : "Erneut versuchen"}
        </button>
      </div>
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
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "segmented segmented-disabled" : "segmented"} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
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

/** "Week 9", Preseason und Playoffs mit Zusatz. */
export function weekLabel(ref: WeekRef): string {
  if (ref.seasonType === 1) return `Preseason ${ref.week}`;
  if (ref.seasonType === 3) return `Playoffs ${ref.week}`;
  return `Week ${ref.week}`;
}

export const PHASE_TEXT: Record<WeekPhase, string> = {
  vergangen: "Vergangene Woche",
  aktuell: "Aktuelle Woche",
  kommend: "Kommende Woche",
};

const Chevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>
);

/**
 * Wochenwähler als Kapsel: zurück, Woche, vor. Ziele als Hash Links (#tipps/2026-2-10), damit die Wahl
 * im Verlauf und in Lesezeichen erhalten bleibt. weeks aufsteigend, value muss nicht enthalten sein.
 */
export function WeekStepper({
  view,
  weeks,
  value,
  current,
  pending = false,
}: {
  view: string;
  weeks: readonly WeekRef[];
  value: WeekRef;
  current: WeekRef | null;
  /** Neue Woche wird geladen: dezenter Indikator, Inhalt bleibt stehen. */
  pending?: boolean;
}) {
  const prev = [...weeks].reverse().find((w) => compareRef(w, value) < 0) ?? null;
  const next = weeks.find((w) => compareRef(w, value) > 0) ?? null;
  const isCurrent = current !== null && sameRef(value, current);
  const href = (r: WeekRef) => `#${view}/${weekKey(r)}`;
  const step = (target: WeekRef | null, dir: "left" | "right") => {
    const text = dir === "left" ? "Vorherige Woche" : "Nächste Woche";
    return target ? (
      <a className="step" href={href(target)} aria-label={`${text}, ${weekLabel(target)}`} title={weekLabel(target)}>
        <Chevron dir={dir} />
      </a>
    ) : (
      <span className="step step-disabled" role="link" aria-disabled="true" aria-label={`${text}, keine weitere`}>
        <Chevron dir={dir} />
      </span>
    );
  };
  return (
    <nav className={pending ? "week-stepper week-stepper-pending" : "week-stepper"} aria-label="Woche wählen" aria-busy={pending || undefined}>
      {step(prev, "left")}
      {isCurrent || !current ? (
        <span className="step-label" aria-current={isCurrent ? "page" : undefined}>
          W{value.week}
        </span>
      ) : (
        <a className="step-label step-today" href={href(current)} aria-label={`Zur aktuellen Woche, ${weekLabel(current)}`} title="Zur aktuellen Woche">
          W{value.week}
        </a>
      )}
      {step(next, "right")}
    </nav>
  );
}
