import { createContext, useContext, useLayoutEffect, useState } from "react";

// Layoutwahl nach D035 bis D039: Breite plus gemessener rechter Safe Area Inset, nicht das Gerät.
export type Layout = "compact" | "medium" | "side" | "wide";

export const WIDE_MIN = 840;
export const MEDIUM_MIN = 600;
export const SIDE_INSET_MIN = 40;
/** Ab diesem rechten Inset ist die Spalte der reservierte Bereich des Duo (D036, D037). */
export const DUO_INSET_MIN = 80;

/**
 * Reservierte Spalte des iPhone Duo, die iOS ganz aus der App herausschneidet (Gerätetest 2026-11-03):
 * Bildschirm 466 breit, App nur 382, Safe Area rechts 0. Erkannt am Unterschied von 60 bis 120 Punkten
 * zwischen Bildschirmbreite und App Breite. Im Querformat meldet screen die Hochformat Breite, dann ist
 * die App breiter als screen und der Wert 0.
 */
export function reservedColumn(screenWidth: number, appWidth: number): number {
  const diff = screenWidth - appWidth;
  return diff >= 60 && diff <= 120 ? diff : 0;
}

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

/** Ein Messpunkt für die Diagnose in den Einstellungen (Duo Gerätetest, R113). */
export interface LayoutSample {
  at: string;
  reason: string;
  layout: Layout;
  inner: string;
  screen: string;
  visual: string;
  dpr: number;
  insets: string;
  standalone: boolean;
}

const samples: LayoutSample[] = [];
const sampleListeners = new Set<() => void>();

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function recordSample(probe: HTMLElement, reason: string, layout: Layout): void {
  const cs = getComputedStyle(probe);
  const vv = window.visualViewport;
  const nav = navigator as Navigator & { standalone?: boolean };
  const sample: LayoutSample = {
    at: new Date().toLocaleTimeString("de-CH"),
    reason,
    layout,
    inner: `${window.innerWidth} x ${window.innerHeight}`,
    screen: `${window.screen.width} x ${window.screen.height}`,
    visual: vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)} ab ${Math.round(vv.offsetTop)}` : "keine",
    dpr: window.devicePixelRatio,
    insets: `oben ${px(cs.paddingTop)} rechts ${px(cs.paddingRight)} unten ${px(cs.paddingBottom)} links ${px(cs.paddingLeft)}`,
    standalone: nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches,
  };
  const last = samples[samples.length - 1];
  const same = last && JSON.stringify({ ...last, at: "", reason: "" }) === JSON.stringify({ ...sample, at: "", reason: "" });
  if (same) return;
  samples.push(sample);
  if (samples.length > 12) samples.shift();
  sampleListeners.forEach((l) => l());
}

/** Letzte Messungen (neueste zuletzt) und Abo für Änderungen, für die Diagnose in den Einstellungen. */
export function layoutSamples(): readonly LayoutSample[] {
  return samples;
}
export function onLayoutSample(listener: () => void): () => void {
  sampleListeners.add(listener);
  return () => sampleListeners.delete(listener);
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
    const first = chooseLayout(window.innerWidth, reservedColumn(window.screen.width, window.innerWidth));
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
    let reason = "Start";
    const apply = () => {
      const inset = measureInsetRight(probe);
      const reserved = reservedColumn(window.screen.width, window.innerWidth);
      const next = chooseLayout(window.innerWidth, Math.max(inset, reserved));
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
      recordSample(probe, reason, next);
    };
    let frame = 0;
    const updateFor = (why: string) => () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        reason = why;
        apply();
      });
    };
    const onResize = updateFor("Grösse");
    const onOrientation = updateFor("Drehung");
    const onViewport = updateFor("Viewport");
    const onProbe = updateFor("Safe Area");
    const onPageshow = updateFor("pageshow");
    const onReturn = updateFor("Rückkehr");
    apply();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", onViewport);
    // iOS liefert die Safe Area in der Home Bildschirm App teils erst nach dem Start oder nach der Rückkehr
    // aus dem Hintergrund, ohne resize Ereignis. Darum die Sonde selbst beobachten und zusätzlich nachmessen.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onProbe) : null;
    observer?.observe(probe, { box: "border-box" });
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageshow);
    const timers = [100, 500, 1500].map((ms) => window.setTimeout(updateFor(`nach ${ms} ms`), ms));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", onViewport);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageshow);
      timers.forEach((t) => window.clearTimeout(t));
      probe.remove();
    };
  }, []);

  return layout;
}

export const LayoutContext = createContext<Layout>("compact");
export const useLayoutValue = () => useContext(LayoutContext);
