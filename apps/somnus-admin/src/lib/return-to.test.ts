import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberReturnTo, takeReturnTo } from "./return-to.js";

describe("returning to a Drive link after sign-in", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("returns once to the Drive address that asked for sign-in", () => {
    rememberReturnTo("/drive?share=s1&file=f1");
    expect(takeReturnTo()).toBe("/drive?share=s1&file=f1");
    expect(takeReturnTo()).toBeNull();
  });

  it.each(["/", "/admin", "https://evil.example/drive", "//evil.example/drive", "/driveway"])(
    "never remembers %s",
    (path) => {
      rememberReturnTo(path);
      expect(takeReturnTo()).toBeNull();
    },
  );

  it("forgets it after half an hour", () => {
    vi.useFakeTimers();
    rememberReturnTo("/drive?share=s1");
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(takeReturnTo()).toBeNull();
  });
});
