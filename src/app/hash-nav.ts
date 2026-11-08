// Hash Navigation für Auswahl und Blatt. Ein geöffnetes Blatt legt genau einen Verlaufseintrag an und markiert
// ihn in history.state. Schliessen geht auf diesen Eintrag zurück, damit Zurück das Blatt nicht wieder öffnet.
// Wechsel innerhalb derselben Woche (Pfeile, Auswahl in der Liste, Wischen im Karussell) ersetzen den Eintrag.

/** Marke im history.state: dieser Eintrag hat ein Blatt geöffnet. */
export const SHEET_MARK = "nflSheet";

/** Kleinster Ausschnitt von window, damit die Logik ohne Browser testbar ist. */
export interface HashWindow {
  location: { hash: string; href: string };
  history: {
    state: unknown;
    pushState(data: unknown, unused: string, url?: string): void;
    replaceState(data: unknown, unused: string, url?: string): void;
    back(): void;
  };
  dispatchEvent(event: Event): boolean;
}

const win = (): HashWindow => window as unknown as HashWindow;

function stateWith(state: unknown, mark: boolean): Record<string, unknown> {
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  if (mark) base[SHEET_MARK] = true;
  else delete base[SHEET_MARK];
  return base;
}

function notify(w: HashWindow, oldURL: string): void {
  try {
    w.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: w.location.href }));
  } catch {
    // Ohne HashChangeEvent (alte Umgebung) ein einfaches Ereignis
    w.dispatchEvent(new Event("hashchange"));
  }
}

/** true, wenn der aktuelle Verlaufseintrag ein Blatt geöffnet hat. */
export function sheetEntry(w: HashWindow = win()): boolean {
  const s = w.history.state;
  return Boolean(s && typeof s === "object" && (s as Record<string, unknown>)[SHEET_MARK]);
}

/** Ersetzt den Hash ohne neuen Verlaufseintrag. Die Marke des Eintrags bleibt erhalten. */
export function replaceHash(target: string, w: HashWindow = win()): void {
  if (w.location.hash === target) return;
  const oldURL = w.location.href;
  try {
    w.history.replaceState(w.history.state, "", target);
    notify(w, oldURL);
  } catch {
    w.location.hash = target;
  }
}

/** Öffnet ein Blatt: ein neuer, markierter Verlaufseintrag. */
export function openSheetHash(target: string, w: HashWindow = win()): void {
  if (w.location.hash === target) return;
  const oldURL = w.location.href;
  try {
    w.history.pushState(stateWith(w.history.state, true), "", target);
    notify(w, oldURL);
  } catch {
    w.location.hash = target;
  }
}

/**
 * Schliesst ein Blatt. Hat der aktuelle Eintrag das Blatt geöffnet, geht es einen Schritt zurück, sonst
 * (Link von aussen, Push) ersetzt der Basis Hash den Eintrag.
 */
export function closeSheetHash(base: string, w: HashWindow = win()): void {
  if (sheetEntry(w)) {
    w.history.back();
    return;
  }
  if (w.location.hash === base) return;
  const oldURL = w.location.href;
  try {
    w.history.replaceState(stateWith(w.history.state, false), "", base);
    notify(w, oldURL);
  } catch {
    w.location.hash = base;
  }
}
