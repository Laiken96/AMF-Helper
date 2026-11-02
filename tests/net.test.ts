import { describe, expect, it } from "vitest";
import { isTimeout, timeoutSignal } from "../src/app/net";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("timeoutSignal", () => {
  it("bricht nach dem Zeitlimit ab, nativ", async () => {
    const s = timeoutSignal(10);
    expect(s.aborted).toBe(false);
    await wait(40);
    expect(s.aborted).toBe(true);
    expect(isTimeout(s.reason)).toBe(true);
  });

  it("Ersatz ohne AbortSignal.timeout und AbortSignal.any (iOS Safari 16)", async () => {
    const outer = new AbortController();
    const s = timeoutSignal(10, outer.signal, {});
    expect(s.aborted).toBe(false);
    await wait(40);
    expect(s.aborted).toBe(true);
    expect(isTimeout(s.reason)).toBe(true);
  });

  it("äusseres Signal bricht sofort ab, nativ und mit Ersatz", () => {
    for (const api of [undefined, {}]) {
      const outer = new AbortController();
      const s = timeoutSignal(10_000, outer.signal, api);
      outer.abort();
      expect(s.aborted).toBe(true);
      expect(isTimeout(s.reason)).toBe(false);
    }
  });

  it("bereits abgebrochenes äusseres Signal", () => {
    const outer = new AbortController();
    outer.abort();
    expect(timeoutSignal(10_000, outer.signal, {}).aborted).toBe(true);
  });
});
