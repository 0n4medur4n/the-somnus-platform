import { afterEach, describe, expect, it } from "vitest";
import { withFakeTimers } from "./fake-timers.js";

describe("withFakeTimers", () => {
  const handles: Array<{ restore: () => void }> = [];
  afterEach(() => {
    while (handles.length > 0) {
      const h = handles.pop();
      h?.restore();
    }
  });

  it("pins Date.now to the start time", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const h = withFakeTimers(start);
    handles.push(h);
    expect(Date.now()).toBe(start.getTime());
    h.advance(1000);
    expect(Date.now()).toBe(start.getTime() + 1000);
  });

  it("restore returns real Date.now", () => {
    const before = Date.now();
    const h = withFakeTimers(new Date("2026-01-01T00:00:00.000Z"));
    h.advance(60_000);
    h.restore();
    expect(Math.abs(Date.now() - before)).toBeLessThan(5000);
  });
});
