import { revalidateData } from "./data";
import type { ReactNode } from "react";

export type View = "tipps" | "bilanz" | "spiele" | "news" | "einstellungen";

export interface Route {
  view: View;
  /** Teil nach dem Schrägstrich, z. B. die Woche "2026-2-10" in #tipps/2026-2-10. */
  arg: string | null;
}

const VIEWS: readonly View[] = ["tipps", "bilanz", "spiele", "news", "einstellungen"];

/** Liest den Hash. #spielplan aus älteren Links führt auf Spiele. */
export function routeFromHash(hash: string = window.location.hash): Route {
  const [rawView = "", ...rest] = hash.replace(/^#/, "").split("/");
  const name = rawView === "spielplan" ? "spiele" : rawView;
  const view = (VIEWS as readonly string[]).includes(name) ? (name as View) : "tipps";
  let arg: string | null = null;
  if (rest.length > 0) {
    try {
      arg = decodeURIComponent(rest.join("/"));
    } catch {
      // Ungültige Kodierung wie %E0: Hash ohne Zusatz behandeln
      arg = null;
    }
  }
  return { view, arg: arg || null };
}

const Icon = ({ children, strong = false }: { children: ReactNode; strong?: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strong ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS: Record<View, (active: boolean) => ReactNode> = {
  tipps: (a) => (
    <Icon strong={a}>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
    </Icon>
  ),
  bilanz: (a) => (
    <Icon strong={a}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </Icon>
  ),
  spiele: (a) => (
    <Icon strong={a}>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M12 5v14" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M2 9.5h3v5H2" />
      <path d="M22 9.5h-3v5h3" />
    </Icon>
  ),
  news: (a) => (
    <Icon strong={a}>
      <path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v10a2 2 0 0 1-2 2" />
      <path d="M8 9h5" />
      <path d="M8 13h5" />
      <path d="M8 17h3" />
    </Icon>
  ),
  einstellungen: (a) => (
    <Icon strong={a}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  ),
};

export const NAV: { view: View; label: string }[] = [
  { view: "tipps", label: "Tipps" },
  { view: "bilanz", label: "Bilanz" },
  { view: "spiele", label: "Spiele" },
  { view: "news", label: "News" },
  { view: "einstellungen", label: "Einstellungen" },
];

/** Navigation als Kapsel. Waagrecht schwebend unten oder senkrecht in der rechten Spalte (per CSS). */
export function NavCapsule({ view }: { view: View }) {
  return (
    <nav className="nav-capsule" aria-label="Hauptnavigation">
      {NAV.map((item) => {
        const active = view === item.view;
        return (
          <a
            key={item.view}
            href={`#${item.view}`}
            aria-label={item.label}
            title={item.label}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {ICONS[item.view](active)}
          </a>
        );
      })}
    </nav>
  );
}

/** Werkzeugkapsel über der senkrechten Navigation (D037): Aktualisieren und Benachrichtigungen. */
export function ToolCapsule() {
  return (
    <div className="tool-capsule" role="group" aria-label="Werkzeuge">
      <button type="button" aria-label="Aktualisieren" title="Aktualisieren" onClick={() => void revalidateData()}>
        <Icon>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </Icon>
      </button>
      <a href="#einstellungen" aria-label="Benachrichtigungen" title="Benachrichtigungen">
        <Icon>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21h4" />
        </Icon>
      </a>
    </div>
  );
}
