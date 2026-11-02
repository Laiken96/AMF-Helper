import { useCallback, useEffect, useState } from "react";
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

  const closeOnboarding = useCallback(() => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  return (
    <LayoutContext.Provider value={layout}>
      <div className="app">
        <main className={`page view-${view}`}>
          {view === "tipps" && <TipsView arg={arg} />}
          {view === "bilanz" && <ReviewView arg={arg} />}
          {view === "spiele" && <GamesView arg={arg} />}
          {view === "news" && <NewsView />}
          {view === "einstellungen" && <SettingsView onShowOnboarding={() => setShowOnboarding(true)} />}
        </main>
        <aside className="rail" aria-label="Navigation">
          {layout === "wide" && <ToolCapsule />}
          <NavCapsule view={view} />
        </aside>
      </div>
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}
    </LayoutContext.Provider>
  );
}

