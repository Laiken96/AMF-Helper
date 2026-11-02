// Farbhilfen für Teamfarben. teams.json liefert Hex ohne #, teils null.
// Kontrast nach WCAG 2.1, relative Leuchtdichte aus sRGB.

export const FALLBACK_TEAM_COLOR = "#3A414D";
const BG = "#0B0E13";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function luminance(rgb: Rgb): number {
  const ch = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a) ?? [0, 0, 0]);
  const lb = luminance(parseHex(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Teamfarbe als #rrggbb, ohne Farbe der neutrale Ersatz. */
export function teamColor(color: string | null | undefined): string {
  const rgb = color ? parseHex(color) : null;
  return rgb ? toHex(rgb) : FALLBACK_TEAM_COLOR;
}

/**
 * Dunkelt eine Farbe so weit Richtung Hintergrund ab, dass auch der hellgraue Nebentext (#E4E8EE)
 * mindestens 4.5 zu 1 erreicht. Weiss liegt dann deutlich darüber.
 */
export function shadeForText(hex: string): string {
  const base = parseHex(hex) ?? parseHex(FALLBACK_TEAM_COLOR)!;
  const bg = parseHex(BG)!;
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(base, bg, t);
    if (contrast(toHex(c), "#E4E8EE") >= 4.8) return toHex(c);
  }
  return BG;
}

/** Hellt sehr dunkle Teamfarben auf, damit Punkt und Ring auf dunkler Fläche sichtbar bleiben. */
export function visibleOn(hex: string, surface = "#171B22", min = 2.4): string {
  const base = parseHex(hex) ?? parseHex(FALLBACK_TEAM_COLOR)!;
  for (let t = 0; t <= 1; t += 0.05) {
    const c = toHex(mix(base, [255, 255, 255], t));
    if (contrast(c, surface) >= min) return c;
  }
  return "#FFFFFF";
}
