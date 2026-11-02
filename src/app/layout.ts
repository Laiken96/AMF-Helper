import { createContext, useContext, useLayoutEffect, useState } from "react";

// Layoutwahl nach D035 bis D039: Breite plus gemessener rechter Safe Area Inset, nicht das Gerät.
export type Layout = "compact" | "medium" | "side" | "wide";

export const WIDE_MIN = 840;
export const MEDIUM_MIN = 600;
export const SIDE_INSET_MIN = 40;
/** Ab diesem rechten Inset ist die Spalte der reservierte Bereich des Duo (D036, D037). */
export const DUO_INSET_MIN = 80;

export function chooseLayout(width: number, insetRight: number): Layout {
  if (width >= WIDE_MIN) return "wide";
  if (insetRight >= SIDE_INSET_MIN) return "side";
  if (width >= MEDIUM_MIN) return "medium";
  return "compact";
}

/**
 * Nur für Tests: ?inset=84 simuliert einen rechten Inset, ?insetBottom=34 einen unteren.
 * Gesetzt wird die CSS Variable --test-inset-right bzw. --test-inset-bottom, die in app.css
 * Vorrang vor env(safe-area-inset-*) hat. Ohne Parameter bleibt alles beim echten Wert.
 */
function applyTestInsets(): void {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const root = document.documentElement.style;
  const right = Number(params.get("inset"));
  if (params.has("inset") && Number.isFinite(right) && right >= 0) root.setProperty("--test-inset-right", `${right}px`);
  const bottom = Number(params.get("insetBottom"));
  if (params.has("insetBottom") && Number.isFinite(bottom) && bottom >= 0)
    root.setProperty("--test-inset-bottom", `${bottom}px`);
}

/** Misst den rechten Inset über ein unsichtbares Element mit padding-right aus der CSS Variable. */
function measureInsetRight(probe: HTMLElement): number {
  const v = parseFloat(getComputedStyle(probe).paddingRight);
  return Number.isFinite(v) ? v : 0;
}

/** ID der ersten Spielzeile (data-anchor), die im Viewport sichtbar ist. */
function firstVisibleAnchor(): string | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-anchor]")) {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight && r.width > 0) return el.dataset.anchor ?? null;
  }
  return null;
}

/** Setzt data-layout am Root und hält es bei resize und orientationchange aktuell. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => {
    const first = chooseLayout(window.innerWidth, 0);
    document.documentElement.dataset.layout = first;
    return first;
  });

  // Synchron vor dem ersten Zeichnen messen, damit kein Sprung von compact auf side sichtbar wird
  useLayoutEffect(() => {
    applyTestInsets();
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.className = "inset-probe";
    document.body.appendChild(probe);

    let current: Layout | null = null;
    const apply = () => {
      const inset = measureInsetRight(probe);
      const next = chooseLayout(window.innerWidth, inset);
      // Beim Wechsel die Liste an der ersten sichtbaren Spielzeile halten
      const anchor = current !== null && current !== next ? firstVisibleAnchor() : null;
      current = next;
      if (anchor) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            document.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`)?.scrollIntoView({ block: "start" });
          }),
        );
      }
      document.documentElement.dataset.layout = next;
      if (inset >= DUO_INSET_MIN) document.documentElement.dataset.inset = "duo";
      else delete document.documentElement.dataset.inset;
      setLayout(next);
    };
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    // iOS liefert die Safe Area in der Home Bildschirm App teils erst nach dem Start oder nach der Rückkehr
    // aus dem Hintergrund, ohne resize Ereignis. Darum die Sonde selbst beobachten und zusätzlich nachmessen.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(probe, { box: "border-box" });
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", update);
    const timers = [100, 500, 1500].map((ms) => window.setTimeout(update, ms));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", update);
      timers.forEach((t) => window.clearTimeout(t));
      probe.remove();
    };
  }, []);

  return layout;
}

export const LayoutContext = createContext<Layout>("compact");
export const useLayoutValue = () => useContext(LayoutContext);
