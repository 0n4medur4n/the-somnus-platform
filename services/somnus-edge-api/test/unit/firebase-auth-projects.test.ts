import { describe, expect, it } from "vitest";
import {
  parseAuthProjectIds,
  unverifiedAudience,
} from "../../src/infrastructure/firebase/firebase.service.js";

/**
 * FIREBASE_PROJECT_ID may list more than one project while Authentication
 * moves between projects (2026-10). These are the two pure pieces of that: the
 * list itself, and reading a token's `aud` to choose which project verifies it.
 */

const jwt = (claims: unknown): string =>
  ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");

describe("parseAuthProjectIds", () => {
  it("keeps a single id as it always was", () => {
    expect(parseAuthProjectIds("the-somnus")).toEqual(["the-somnus"]);
  });

  it("splits, trims, drops empties and duplicates, and keeps order", () => {
    expect(parseAuthProjectIds(" the-somnus , the-somnuss,,the-somnus ")).toEqual([
      "the-somnus",
      "the-somnuss",
    ]);
  });

  it("refuses a value that names no project", () => {
    expect(() => parseAuthProjectIds(" , ")).toThrow();
  });
});

describe("unverifiedAudience", () => {
  it("reads aud from the payload", () => {
    expect(unverifiedAudience(jwt({ aud: "the-somnus", sub: "u" }))).toBe("the-somnus");
  });

  it.each([
    ["no payload segment", "only-one-part"],
    ["a payload that is not base64 JSON", "a.!!!.c"],
    ["a payload with no aud", jwt({ sub: "u" })],
    ["an aud that is not a string", jwt({ aud: ["the-somnus"] })],
    ["an empty string", ""],
  ])("returns null for %s, so the token is rejected", (_label, token) => {
    expect(unverifiedAudience(token)).toBeNull();
  });
});
