import { describe, expect, it } from "vitest";
import { chooseLayout, reservedColumn } from "../src/app/layout";

describe("Layoutwahl iPhone Duo (Gerätetest R113)", () => {
  it("zugeklappt: App 382 auf Bildschirm 466 ergibt reservierte Spalte 84 und Layout side", () => {
    expect(reservedColumn(466, 382)).toBe(84);
    expect(chooseLayout(382, reservedColumn(466, 382))).toBe("side");
  });
  it("aufgeklappt quer: App breiter als gemeldeter Bildschirm ergibt 0 und Layout wide", () => {
    expect(reservedColumn(466, 867)).toBe(0);
    expect(chooseLayout(867, 0)).toBe("wide");
  });
  it("normales iPhone ohne Unterschied bleibt compact", () => {
    expect(reservedColumn(393, 393)).toBe(0);
    expect(chooseLayout(393, 0)).toBe("compact");
  });
  it("kurzer Startwert mit voller Breite bleibt compact, kleine Unterschiede zählen nicht", () => {
    expect(reservedColumn(466, 466)).toBe(0);
    expect(reservedColumn(466, 440)).toBe(0);
  });
});
