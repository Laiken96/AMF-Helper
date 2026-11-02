import { describe, expect, it } from "vitest";
import { SHEET_CLOSE_DISTANCE, shouldCloseSheet } from "../src/app/sheet-gesture";

describe("Spielblatt Wischgeste", () => {
  it("schliesst ab 80 px nach unten, auch langsam", () => {
    expect(SHEET_CLOSE_DISTANCE).toBe(80);
    expect(shouldCloseSheet(80, 0)).toBe(true);
    expect(shouldCloseSheet(79, 0.1)).toBe(false);
  });

  it("schliesst bei schneller kurzer Geste", () => {
    expect(shouldCloseSheet(30, 0.8)).toBe(true);
  });

  it("federt bei sehr kurzer Strecke zurück, auch wenn schnell", () => {
    expect(shouldCloseSheet(10, 2)).toBe(false);
    expect(shouldCloseSheet(0, 0)).toBe(false);
  });
});
