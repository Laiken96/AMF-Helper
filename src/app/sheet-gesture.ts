// Wischgeste des Spielblatts, ohne React, damit Tests sie direkt prüfen können.

/** Ab dieser Strecke nach unten schliesst das Blatt beim Loslassen. */
export const SHEET_CLOSE_DISTANCE = 80;
/** Schnelle Geste: ab dieser Geschwindigkeit (px pro ms) genügt eine kurze Strecke. */
export const SHEET_FLICK_VELOCITY = 0.5;
const SHEET_FLICK_MIN = 24;
/** Erst ab dieser Bewegung gilt ein Druck als Wischen, darunter bleibt er ein Antippen. */
export const DRAG_START = 4;

/** Entscheidet beim Loslassen: schliessen oder zurückfedern. dy in px nach unten, velocity in px pro ms. */
export function shouldCloseSheet(dy: number, velocity: number): boolean {
  if (dy >= SHEET_CLOSE_DISTANCE) return true;
  return dy >= SHEET_FLICK_MIN && velocity >= SHEET_FLICK_VELOCITY;
}
