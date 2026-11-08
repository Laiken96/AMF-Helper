import { startRevalidation } from "./data";
import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { GamesView } from "./GamesView";
import { NewsView } from "./NewsView";
import { markOnboardingSeen, onboardingSeen, registerServiceWorker } from "./push";
import { ReviewView } from "./ReviewView";
import { Onboarding, SettingsView } from "./SettingsView";
import { TipsView } from "./TipsView";
import { LayoutContext, useLayout } from "./layout";
import { NavCapsule, ToolCapsule, routeFromHash, type Route } from "./Nav";

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const { view, arg } = route;
  const [showOnboarding, setShowOnboarding] = useState(() => !onboardingSeen());
  const layout = useLayout();

  useEffect(() => {
    const onHash = () => {
      setRoute((prev) => {
        const next = routeFromHash();
        return next.view === prev.view && next.arg === prev.arg ? prev : next;
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Daten alle 5 Minuten im Hintergrund prüfen, solange die App sichtbar ist
  useEffect(() => startRevalidation(), []);

  const closeOnboarding = useCallback(() => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  return (
    <LayoutContext.Provider value={layout}>
      <div className="app">
        <main className={`page view-${view}`}>
          {/* Fehlergrenze nur um den Inhalt, Navigation bleibt nutzbar. key setzt sie beim Reiterwechsel zurück, resetKey bei anderer Woche */}
          <ErrorBoundary key={view} resetKey={arg ?? ""}>
            {view === "tipps" && <TipsView arg={arg} />}
            {view === "bilanz" && <ReviewView arg={arg} />}
            {view === "spiele" && <GamesView arg={arg} />}
            {view === "news" && <NewsView />}
            {view === "einstellungen" && <SettingsView onShowOnboarding={() => setShowOnboarding(true)} />}
          </ErrorBoundary>
        </main>
        <aside className="rail" aria-label="Navigation">
          {(layout === "wide" || layout === "side") && <ToolCapsule />}
          <NavCapsule view={view} />
        </aside>
      </div>
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}
    </LayoutContext.Provider>
  );
}

