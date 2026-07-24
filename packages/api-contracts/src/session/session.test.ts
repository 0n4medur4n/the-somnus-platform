import { describe, expect, it } from "vitest";
import { SessionCreateRequestSchema, SessionResponseSchema } from "./session.js";

describe("SessionCreateRequestSchema", () => {
  it("accepts a request with an idToken", () => {
    expect(SessionCreateRequestSchema.safeParse({ idToken: "abc" }).success).toBe(true);
  });

  it("rejects an empty idToken", () => {
    expect(SessionCreateRequestSchema.safeParse({ idToken: "" }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(SessionCreateRequestSchema.safeParse({ idToken: "abc", extra: 1 }).success).toBe(false);
  });
});

describe("SessionResponseSchema", () => {
  it("accepts a response with a null email", () => {
    const r = SessionResponseSchema.safeParse({
      firebaseUid: "uid-1",
      email: null,
      expiresAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-datetime expiresAt", () => {
    expect(
      SessionResponseSchema.safeParse({ firebaseUid: "u", email: null, expiresAt: "soon" }).success,
    ).toBe(false);
  });
});
