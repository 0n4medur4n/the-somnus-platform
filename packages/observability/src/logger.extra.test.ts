import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";
import { REDACTED } from "./redact.js";

const service = { name: "somnus-test", env: "test", version: "0.0.0", commit: "local" };

describe("createLogger — extra coverage", () => {
  it("emits text format when configured", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c1", format: "text", write: writer });
    logger.info("hello", { userId: "u1", durationMs: 12 });
    const raw = writer.mock.calls[0]?.[0] as string;
    expect(raw).toMatch(/^20\d\d-\d\d-\d\dT/);
    expect(raw).toContain("INFO ");
    expect(raw).toContain("[somnus-test]");
    expect(raw).toContain("hello");
    expect(raw).toContain("corr=c1");
    expect(raw).toContain("durationMs=12");
    expect(raw).toContain("userId");
  });

  it("emits error details when present and redacted", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c2", write: writer });
    logger.error("oops", {
      error: { code: "INTERNAL", message: "boom", details: { token: "leaky" } },
    });
    const parsed = JSON.parse(writer.mock.calls[0]?.[0] as string);
    expect(parsed.error).toEqual({
      code: "INTERNAL",
      message: "boom",
      details: { token: REDACTED },
    });
  });

  it("withCorrelationId replaces the correlationId on the returned logger", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "parent", write: writer });
    const child = logger.withCorrelationId("child");
    child.info("hi");
    const parsed = JSON.parse(writer.mock.calls[0]?.[0] as string);
    expect(parsed.correlationId).toBe("child");
  });

  it("ignores an error object that is malformed (no code/message)", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c3", write: writer });
    logger.warn("weird", { error: { not: "an error" } });
    const parsed = JSON.parse(writer.mock.calls[0]?.[0] as string);
    expect(parsed.error).toBeUndefined();
  });

  it("ignores a non-object error field", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c4", write: writer });
    logger.warn("weird", { error: "just a string" });
    const parsed = JSON.parse(writer.mock.calls[0]?.[0] as string);
    expect(parsed.error).toBeUndefined();
  });

  it("ignores error that is an array", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c5", write: writer });
    logger.warn("weird", { error: [1, 2, 3] });
    const parsed = JSON.parse(writer.mock.calls[0]?.[0] as string);
    expect(parsed.error).toBeUndefined();
  });

  it("ignores durationMs when not a number", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c6", write: writer });
    logger.info("x", { durationMs: "10" });
    const parsed = JSON.parse(writer.mock.calls[0]?.[0] as string);
    expect(parsed.durationMs).toBeUndefined();
  });
});
