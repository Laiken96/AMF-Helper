import { describe, expect, it } from "vitest";
import { isTransient } from "../jobs/opinion";

describe("isTransient", () => {
  it("zählt Rate Limit, Überlastung und Serverfehler nicht als Versuch", () => {
    for (const s of [408, 429, 500, 529]) expect(isTransient(s)).toBe(true);
  });
  it("zählt Timeout und Netzfehler ohne Status als Versuch, die Anfrage kann bezahlt sein", () => {
    expect(isTransient(undefined)).toBe(false);
  });
  it("zählt ungültigen oder gesperrten Schlüssel nicht als Versuch", () => {
    expect(isTransient(401)).toBe(true);
    expect(isTransient(403)).toBe(true);
  });
  it("zählt andere Client Fehler als Versuch", () => {
    for (const s of [400, 404, 413, 422]) expect(isTransient(s)).toBe(false);
  });
});

import { forgiveTransient } from "../jobs/opinion";

describe("forgiveTransient", () => {
  it("verwirft Einträge mit vorübergehendem letzten Fehler und behält inhaltliche", () => {
    const a = {
      schemaVersion: 1 as const,
      entries: [
        { gameId: "1", attempts: 2, lastAt: "2026-11-02T19:30:55Z", lastResult: "API Fehler HTTP 401: invalid x-api-key" },
        { gameId: "2", attempts: 1, lastAt: "2026-11-02T19:30:55Z", lastResult: "keine gültige Quelle" },
        { gameId: "3", attempts: 1, lastAt: "2026-11-02T19:30:55Z", lastResult: "API Fehler HTTP 400: bad request" },
        { gameId: "4", attempts: 1, lastAt: "2026-11-02T19:30:55Z", lastResult: "API Fehler: Request timed out." },
        {
          gameId: "5",
          attempts: 1,
          lastAt: "2026-11-02T19:30:55Z",
          lastResult: "Fortsetzung nach bezahlter Anfrage, API Fehler HTTP 529: overloaded",
        },
      ],
    };
    expect(forgiveTransient(a).entries.map((e) => e.gameId)).toEqual(["2", "3", "4", "5"]);
  });
});
