import { createContext, useContext, useEffect, useState } from "react";

// Layoutwahl nach D035 bis D039: Breite plus gemessener rechter Safe Area Inset, nicht das Gerät.
export type Layout = "compact" | "medium" | "side" | "wide";

export const WIDE_MIN = 840;
export const MEDIUM_MIN = 600;
export const SIDE_INSET_MIN = 40;

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

/** Setzt data-layout am Root und hält es bei resize und orientationchange aktuell. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => {
    const first = chooseLayout(window.innerWidth, 0);
    document.documentElement.dataset.layout = first;
    return first;
  });

  useEffect(() => {
    applyTestInsets();
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.className = "inset-probe";
    document.body.appendChild(probe);

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = chooseLayout(window.innerWidth, measureInsetRight(probe));
        document.documentElement.dataset.layout = next;
        setLayout(next);
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      probe.remove();
    };
  }, []);

  return layout;
}

export const LayoutContext = createContext<Layout>("compact");
export const useLayoutValue = () => useContext(LayoutContext);
