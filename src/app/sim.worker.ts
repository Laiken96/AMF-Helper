// Web Worker für die Simulation Platz 1 (D050): 5000 Läufe ohne die Oberfläche zu blockieren.
import { simulateFirstPlace, type SimInput } from "../core/simulate";

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ id: number; input: SimInput }>) => void) | null;
  postMessage: (message: unknown) => void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, input } = e.data;
  const t0 = performance.now();
  try {
    const output = simulateFirstPlace(input);
    scope.postMessage({ id, output, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : "Simulation fehlgeschlagen" });
  }
};
