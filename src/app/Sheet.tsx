import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DRAG_START, shouldCloseSheet } from "./sheet-gesture";

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

interface Drag {
  id: number;
  startY: number;
  dy: number;
  active: boolean;
  /** Letzte Messpunkte für die Geschwindigkeit. */
  lastY: number;
  lastT: number;
  velocity: number;
}

/**
 * Spielbereich als Blatt von unten (compact, side, medium). Hintergrund gesperrt, Fokus bleibt im Blatt.
 * Schliessen per X, Escape, Tippen auf den Hintergrund oder Wischen nach unten an Griff und Kopf.
 */
export function GameSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const drag = useRef<Drag | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    root.classList.add("sheet-open");
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const items = [...sheetRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter(
        (el) => el.tabIndex >= 0 && el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.classList.remove("sheet-open");
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  const setOffset = (dy: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.classList.toggle("sheet-dragging", !animate);
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (closing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    // Der Schliessen Knopf bleibt ein normaler Knopf
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { id: e.pointerId, startY: e.clientY, dy: 0, active: false, lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
    // Sofort einfangen, damit der Zug auch nach Verlassen des Kopfs weiterläuft. Im Kopf gibt es ausser X nichts anzutippen
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ohne Einfangen endet der Zug am Rand des Kopfs
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - d.startY);
    if (!d.active) {
      if (dy < DRAG_START) return;
      d.active = true;
    }
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = 0.7 * ((e.clientY - d.lastY) / dt) + 0.3 * d.velocity;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    d.dy = dy;
    setOffset(dy, false);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    // Seit der letzten Bewegung zu lange still gehalten: keine schnelle Geste mehr
    const velocity = e.timeStamp - d.lastT > 120 ? 0 : d.velocity;
    if (!cancelled && shouldCloseSheet(d.dy, velocity)) {
      closing.current = true;
      const el = sheetRef.current;
      if (!el || reducedMotion()) {
        onCloseRef.current();
        return;
      }
      setOffset(el.offsetHeight + 40, true);
      el.classList.add("sheet-leaving");
      window.setTimeout(() => onCloseRef.current(), 200);
      return;
    }
    setOffset(0, true);
  };

  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={`Spiel ${title}`}>
        <div
          className="sheet-head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
        >
          <span className="sheet-grip" aria-hidden="true" />
          <h2 className="sheet-title">{title}</h2>
          <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Schliessen" title="Schliessen">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
