// Startet die Simulation im Web Worker, ohne Worker per requestIdleCallback im Hauptthread.
// Der Worker hat ein Zeitlimit. Danach wird er beendet und die Ansicht zeigt einen Hinweis mit neuem Versuch,
// statt den Hauptthread mit derselben langen Rechnung zu blockieren.
import { simulateFirstPlace, type SimInput, type SimOutput } from "../core/simulate";

export interface SimRun {
  output: SimOutput;
  ms: number; // Rechenzeit
  where: "worker" | "idle";
}

/** Zeitlimit für eine Rechnung im Worker. */
export const SIM_TIMEOUT_MS = 10_000;

/** Fehler bei überschrittenem Zeitlimit, die Ansicht zeigt dazu einen eigenen Hinweis. */
export class SimTimeoutError extends Error {
  constructor() {
    super("Die Simulation dauerte zu lange");
  }
}

let worker: Worker | null = null;
let seq = 0;
let noWorker = false;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (noWorker || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    return worker;
  } catch {
    return null;
  }
}

function runIdle(input: SimInput): Promise<SimRun> {
  return new Promise((resolve, reject) => {
    const go = () => {
      const t0 = performance.now();
      try {
        resolve({ output: simulateFirstPlace(input), ms: performance.now() - t0, where: "idle" });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Simulation fehlgeschlagen"));
      }
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === "function") ric(go, { timeout: 1000 });
    else window.setTimeout(go, 0);
  });
}

export function runSimulation(input: SimInput, timeoutMs = SIM_TIMEOUT_MS): Promise<SimRun> {
  const w = getWorker();
  if (!w) return runIdle(input);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    // Zu lange Rechnung: Worker beenden, der nächste Versuch startet einen neuen
    const timer = window.setTimeout(() => {
      cleanup();
      w.terminate();
      if (worker === w) worker = null;
      reject(new SimTimeoutError());
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (e: MessageEvent<{ id: number; output?: SimOutput; ms?: number; error?: string }>) => {
      if (e.data.id !== id) return;
      cleanup();
      if (e.data.output) resolve({ output: e.data.output, ms: e.data.ms ?? 0, where: "worker" });
      else reject(new Error(e.data.error ?? "Simulation fehlgeschlagen"));
    };
    // Worker nicht ladbar: einmal im Hauptthread rechnen und künftig ohne Worker
    const onError = (ev: Event) => {
      ev.preventDefault();
      cleanup();
      w.terminate();
      worker = null;
      noWorker = true;
      runIdle(input).then(resolve, reject);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, input });
  });
}
