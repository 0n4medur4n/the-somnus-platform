import { describe, expect, it } from "vitest";
import {
  computeBackoffMs,
  defaultRetryPolicy,
  isRetriableHttpStatus,
  isRetriableNetworkError,
  noRetryPolicy,
  sleep,
} from "./retry.js";

describe("isRetriableHttpStatus", () => {
  it("retries 408, 425, 429, and 5xx", () => {
    expect(isRetriableHttpStatus(408)).toBe(true);
    expect(isRetriableHttpStatus(425)).toBe(true);
    expect(isRetriableHttpStatus(429)).toBe(true);
    expect(isRetriableHttpStatus(500)).toBe(true);
    expect(isRetriableHttpStatus(502)).toBe(true);
    expect(isRetriableHttpStatus(503)).toBe(true);
    expect(isRetriableHttpStatus(504)).toBe(true);
  });
  it("does not retry 2xx, 3xx, 4xx (except 408/425/429)", () => {
    expect(isRetriableHttpStatus(200)).toBe(false);
    expect(isRetriableHttpStatus(400)).toBe(false);
    expect(isRetriableHttpStatus(401)).toBe(false);
    expect(isRetriableHttpStatus(403)).toBe(false);
    expect(isRetriableHttpStatus(404)).toBe(false);
  });
});

describe("isRetriableNetworkError", () => {
  it("matches AbortError, TimeoutError, TypeError", () => {
    const a = new Error("x");
    a.name = "AbortError";
    const t = new Error("x");
    t.name = "TimeoutError";
    const ty = new TypeError("x");
    expect(isRetriableNetworkError(a)).toBe(true);
    expect(isRetriableNetworkError(t)).toBe(true);
    expect(isRetriableNetworkError(ty)).toBe(true);
  });
  it("does not match a plain Error", () => {
    expect(isRetriableNetworkError(new Error("x"))).toBe(false);
    expect(isRetriableNetworkError("x")).toBe(false);
    expect(isRetriableNetworkError(null)).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  it("grows exponentially within maxDelayMs", () => {
    const p = { ...defaultRetryPolicy, jitter: false };
    expect(computeBackoffMs(p, 0)).toBe(100);
    expect(computeBackoffMs(p, 1)).toBe(200);
    expect(computeBackoffMs(p, 2)).toBe(400);
  });
  it("caps at maxDelayMs", () => {
    const p = { ...defaultRetryPolicy, jitter: false, maxDelayMs: 500 };
    expect(computeBackoffMs(p, 0)).toBe(100);
    expect(computeBackoffMs(p, 1)).toBe(200);
    expect(computeBackoffMs(p, 2)).toBe(400);
    expect(computeBackoffMs(p, 3)).toBe(500);
    expect(computeBackoffMs(p, 10)).toBe(500);
  });
  it("applies jitter when enabled", () => {
    const p = {
      ...defaultRetryPolicy,
      jitter: true,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      backoffMultiplier: 1,
    };
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const v = computeBackoffMs(p, 0);
      expect(v).toBeGreaterThanOrEqual(500);
      expect(v).toBeLessThanOrEqual(1000);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("noRetryPolicy", () => {
  it("has maxAttempts 1", () => {
    expect(noRetryPolicy.maxAttempts).toBe(1);
  });
});

describe("sleep", () => {
  it("resolves after the timeout", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
  it("rejects with AbortError when given an aborted signal", async () => {
    const c = new AbortController();
    c.abort();
    await expect(sleep(1000, c.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
