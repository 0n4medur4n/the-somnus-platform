import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";
import { isRedactedKey, REDACTED, redact, redactValue } from "./redact.js";

const service = { name: "somnus-test", env: "test", version: "0.0.0", commit: "local" };
describe("redact()", () => {
  it("redacts known credential keys", () => {
    const out = redact({
      password: "hunter2",
      token: "abc.def.ghi",
      authorization: "Bearer xyz",
      cookie: "sid=abc",
      apiKey: "k",
      sessionId: "s",
    });
    expect(out).toEqual({
      password: REDACTED,
      token: REDACTED,
      authorization: REDACTED,
      cookie: REDACTED,
      apiKey: REDACTED,
      sessionId: REDACTED,
    });
  });
  it("redacts health fields (build plan §15 / §19)", () => {
    const out = redact({
      userId: "u1",
      answer: "yes",
      answers: ["a", "b"],
      freeText: "I feel...",
      symptom: "headache",
      medication: "ibuprofen",
      diagnosis: "G47.0",
      assessment_score: 12,
      safety_flag: "yellow",
      morpheo_result: { score: 12 },
    });
    expect(out).toEqual({
      userId: "u1",
      answer: REDACTED,
      answers: REDACTED,
      freeText: REDACTED,
      symptom: REDACTED,
      medication: REDACTED,
      diagnosis: REDACTED,
      assessment_score: REDACTED,
      safety_flag: REDACTED,
      morpheo_result: REDACTED,
    });
  });
  it("walks nested objects and arrays", () => {
    const out = redact({
      user: { id: "u1", token: "t1" },
      list: [{ password: "p" }, { password: "p2" }],
    });
    expect(out).toEqual({
      user: { id: "u1", token: REDACTED },
      list: [{ password: REDACTED }, { password: REDACTED }],
    });
  });
  it("leaves non-sensitive data untouched", () => {
    const out = redact({ method: "GET", path: "/v1/me", status: 200 });
    expect(out).toEqual({ method: "GET", path: "/v1/me", status: 200 });
  });
  it("redacts by substring pattern (e.g. apiKey, jwtSecret)", () => {
    const out = redact({ jwtSecret: "s", refreshTokenId: "rt", oAuthBearer: "b" });
    expect(out).toEqual({ jwtSecret: REDACTED, refreshTokenId: REDACTED, oAuthBearer: REDACTED });
  });
});
describe("isRedactedKey", () => {
  it("matches exact keys", () => {
    expect(isRedactedKey("password")).toBe(true);
    expect(isRedactedKey("Token")).toBe(true);
    expect(isRedactedKey("safe")).toBe(false);
  });
});
describe("redactValue", () => {
  it("preserves null and undefined", () => {
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
  });
  it("walks arrays", () => {
    expect(redactValue([{ password: "p" }])).toEqual([{ password: REDACTED }]);
  });
  it("returns primitives untouched", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue("hello")).toBe("hello");
  });
});
describe("createLogger", () => {
  it("emits valid JSON with the expected shape", () => {
    const writer = vi.fn();
    const logger = createLogger({
      service,
      correlationId: "c1",
      write: writer,
    });
    logger.info("hello", { method: "GET" });
    expect(writer).toHaveBeenCalledTimes(1);
    const raw = writer.mock.calls[0]?.[0];
    const parsed = JSON.parse(raw);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("hello");
    expect(parsed.correlationId).toBe("c1");
    expect(parsed.service).toEqual(service);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.data).toEqual({ method: "GET" });
  });
  it("redacts tokens and health fields from the data section", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c2", write: writer });
    logger.info("user did something", {
      userId: "u1",
      token: "abc.def.ghi",
      cookie: "sid=x",
      answer: "yes",
      diagnosis: "G47.0",
    });
    const raw = writer.mock.calls[0]?.[0];
    expect(raw).not.toContain("abc.def.ghi");
    expect(raw).not.toContain("sid=x");
    expect(raw).not.toContain("G47.0");
    expect(raw).not.toContain('yes"');
    const parsed = JSON.parse(raw);
    expect(parsed.data).toEqual({
      userId: "u1",
      token: REDACTED,
      cookie: REDACTED,
      answer: REDACTED,
      diagnosis: REDACTED,
    });
  });
  it("respects the level threshold (debug < info)", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c3", level: "warn", write: writer });
    logger.debug("d");
    logger.info("i");
    expect(writer).not.toHaveBeenCalled();
    logger.warn("w");
    expect(writer).toHaveBeenCalledTimes(1);
  });
  it("propagates correlationId and bindings through child()", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "parent", write: writer });
    const child = logger.child({ component: "auth" });
    child.info("hi");
    const raw = writer.mock.calls[0]?.[0];
    const parsed = JSON.parse(raw);
    expect(parsed.correlationId).toBe("parent");
    expect(parsed.data).toEqual({ component: "auth" });
  });
  it("does not include stack traces in the log shape", () => {
    const writer = vi.fn();
    const logger = createLogger({ service, correlationId: "c4", write: writer });
    logger.error("boom", { error: { code: "INTERNAL", message: "x" } });
    const parsed = JSON.parse(writer.mock.calls[0]?.[0]);
    expect(parsed.error).toEqual({ code: "INTERNAL", message: "x" });
    expect(parsed).not.toHaveProperty("stack");
  });
});
//# sourceMappingURL=logger.test.js.map
