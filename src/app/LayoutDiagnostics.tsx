import { useEffect, useState } from "react";
import { layoutSamples, onLayoutSample } from "./layout";

/** Messwerte von Viewport und Safe Area für den Gerätetest am iPhone Duo (R113). Nur in Einstellungen, Technik. */
export function LayoutDiagnostics() {
  const [, setTick] = useState(0);
  useEffect(() => onLayoutSample(() => setTick((t) => t + 1)), []);
  const list = [...layoutSamples()].reverse();
  if (list.length === 0) return null;
  return (
    <div className="layout-diag">
      <p>Diagnose Layout, neueste zuerst. Bitte als Screenshot schicken, wenn das Layout nicht passt.</p>
      <ol>
        {list.map((s, i) => (
          <li key={`${s.at}-${i}`}>
            <strong>
              {s.at} {s.reason}: {s.layout}
            </strong>
            <br />
            App {s.inner}, Bildschirm {s.screen}, sichtbar {s.visual}, Faktor {s.dpr}
            <br />
            Safe Area {s.insets}, {s.standalone ? "Home Bildschirm App" : "Browser"}
          </li>
        ))}
      </ol>
    </div>
  );
}
