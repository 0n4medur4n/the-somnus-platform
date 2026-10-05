import { describe, expect, it } from "vitest";
import {
  CsrfTokenResponseSchema,
  SessionCreateRequestSchema,
  SessionResponseSchema,
} from "./session.js";

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
      csrfToken: "tok",
    });
    expect(r.success).toBe(true);
  });

  it("requires the CSRF token: the SPA has no other way to obtain it", () => {
    const r = SessionResponseSchema.safeParse({
      firebaseUid: "uid-1",
      email: null,
      expiresAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty CSRF token", () => {
    const r = SessionResponseSchema.safeParse({
      firebaseUid: "uid-1",
      email: null,
      expiresAt: new Date().toISOString(),
      csrfToken: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-datetime expiresAt", () => {
    expect(
      SessionResponseSchema.safeParse({
        firebaseUid: "u",
        email: null,
        expiresAt: "soon",
        csrfToken: "tok",
      }).success,
    ).toBe(false);
  });
});

describe("CsrfTokenResponseSchema", () => {
  it("accepts a token", () => {
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken: "tok" }).success).toBe(true);
  });

  it("rejects a missing or empty token", () => {
    expect(CsrfTokenResponseSchema.safeParse({}).success).toBe(false);
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken: "" }).success).toBe(false);
  });
});
