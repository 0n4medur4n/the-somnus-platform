import { ErrorCode } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import { ApiErrorResponseSchema, buildApiErrorResponse } from "./error.js";

describe("ApiErrorResponseSchema", () => {
  it("accepts the §16 shape", () => {
    const r = ApiErrorResponseSchema.safeParse({
      error: {
        code: "NOT_FOUND",
        message: "x",
        correlationId: "corr-1",
        details: { id: "abc" },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an error object missing required fields", () => {
    const r = ApiErrorResponseSchema.safeParse({
      error: { code: "NOT_FOUND" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty correlationId", () => {
    const r = ApiErrorResponseSchema.safeParse({
      error: { code: "NOT_FOUND", message: "x", correlationId: "", details: {} },
    });
    expect(r.success).toBe(false);
  });

  it("defaults details to {} when omitted", () => {
    const r = ApiErrorResponseSchema.parse({
      error: { code: "NOT_FOUND", message: "x", correlationId: "c" },
    });
    expect(r.error.details).toEqual({});
  });
});

describe("buildApiErrorResponse", () => {
  it("produces a body that round-trips through the schema", () => {
    const body = buildApiErrorResponse({
      code: ErrorCode.UNAUTHENTICATED,
      correlationId: "corr-2",
      details: { reason: "no_token" },
    });
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.correlationId).toBe("corr-2");
    expect(body.error.details).toEqual({ reason: "no_token" });
    const r = ApiErrorResponseSchema.safeParse(body);
    expect(r.success).toBe(true);
  });
});
