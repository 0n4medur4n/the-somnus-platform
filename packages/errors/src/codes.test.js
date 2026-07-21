import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  errorCodeToHttpStatus,
  isSomnusError,
  toHttpResponse,
  toLogShape,
} from "./codes.js";
import { SomnusError } from "./error.js";

describe("errorCodeToHttpStatus", () => {
  it("maps every known code to a 4xx or 5xx status", () => {
    const knownCodes = Object.values(ErrorCode);
    expect(knownCodes.length).toBeGreaterThan(0);
    for (const code of knownCodes) {
      const status = errorCodeToHttpStatus[code];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
  it("explicit values match the build plan conventions", () => {
    expect(errorCodeToHttpStatus.UNAUTHENTICATED).toBe(401);
    expect(errorCodeToHttpStatus.FORBIDDEN).toBe(403);
    expect(errorCodeToHttpStatus.NOT_FOUND).toBe(404);
    expect(errorCodeToHttpStatus.RATE_LIMITED).toBe(429);
    expect(errorCodeToHttpStatus.CONSENT_REQUIRED).toBe(412);
    expect(errorCodeToHttpStatus.CONSENT_WITHDRAWN).toBe(412);
    expect(errorCodeToHttpStatus.ACCESS_GRANT_EXPIRED).toBe(410);
    expect(errorCodeToHttpStatus.INTERNAL).toBe(500);
    expect(errorCodeToHttpStatus.UPSTREAM_UNAVAILABLE).toBe(502);
  });
  it("rejects an unknown code via runtime check (no silent fallthrough)", () => {
    const status = errorCodeToHttpStatus["__NOT_A_REAL_CODE__"];
    expect(status).toBeUndefined();
  });
});
describe("toHttpResponse", () => {
  it("returns the §16 shape with code, message, correlationId, details", () => {
    const r = toHttpResponse(ErrorCode.NOT_FOUND, "corr-1", { id: "abc" });
    expect(r.error.code).toBe("NOT_FOUND");
    expect(r.error.message).toBe("The requested resource was not found.");
    expect(r.error.correlationId).toBe("corr-1");
    expect(r.error.details).toEqual({ id: "abc" });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.error)).toBe(true);
  });
  it("never leaks internal cause or stack in the HTTP body", () => {
    const r = toHttpResponse(ErrorCode.INTERNAL, "corr-2");
    expect(r.error).not.toHaveProperty("stack");
    expect(r.error).not.toHaveProperty("cause");
  });
});
describe("toLogShape", () => {
  it("returns a loggable shape with code, message, correlationId, details", () => {
    const s = toLogShape(ErrorCode.VALIDATION_FAILED, "field x missing", "corr-3", { field: "x" });
    expect(s.code).toBe("VALIDATION_FAILED");
    expect(s.message).toBe("field x missing");
    expect(s.correlationId).toBe("corr-3");
    expect(s.details).toEqual({ field: "x" });
  });
});
describe("SomnusError", () => {
  it("carries code, correlationId, details, cause", () => {
    const cause = new Error("db down");
    const e = new SomnusError(ErrorCode.UPSTREAM_UNAVAILABLE, "morpheo unreachable", {
      correlationId: "corr-4",
      details: { url: "morpheo-service" },
      cause,
    });
    expect(e.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(e.correlationId).toBe("corr-4");
    expect(e.details).toEqual({ url: "morpheo-service" });
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("SomnusError");
    expect(e instanceof Error).toBe(true);
    expect(isSomnusError(e)).toBe(true);
  });
  it("toJSON is safe (no stack)", () => {
    const e = new SomnusError(ErrorCode.INTERNAL, "boom", { correlationId: "c" });
    const j = e.toJSON();
    expect(j).toEqual({
      name: "SomnusError",
      code: "INTERNAL",
      message: "boom",
      correlationId: "c",
      details: {},
    });
    expect(j).not.toHaveProperty("stack");
  });
  it("isSomnusError returns false for a plain Error", () => {
    expect(isSomnusError(new Error("x"))).toBe(false);
    expect(isSomnusError(null)).toBe(false);
    expect(isSomnusError(undefined)).toBe(false);
    expect(isSomnusError("SomnusError")).toBe(false);
  });
});
//# sourceMappingURL=codes.test.js.map
