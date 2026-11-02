import { describe, expect, it } from "vitest";
import { isTransient } from "../jobs/opinion";

describe("isTransient", () => {
  it("zählt Netz, Rate Limit, Überlastung und Serverfehler nicht als Versuch", () => {
    for (const s of [undefined, 408, 429, 500, 529]) expect(isTransient(s)).toBe(true);
  });
  it("zählt ungültigen oder gesperrten Schlüssel nicht als Versuch", () => {
    expect(isTransient(401)).toBe(true);
    expect(isTransient(403)).toBe(true);
  });
  it("zählt andere Client Fehler als Versuch", () => {
    for (const s of [400, 404, 413, 422]) expect(isTransient(s)).toBe(false);
  });
});
