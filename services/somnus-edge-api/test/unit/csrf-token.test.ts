import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { csrfTokenFor, csrfTokenMatches } from "../../src/bootstrap/csrf-token.js";

/**
 * The session-bound CSRF token. It replaced @fastify/csrf-protection when the
 * API moved behind Firebase Hosting, which forwards only the `__session`
 * cookie, so there is no second cookie to keep a secret in.
 *
 * What it must guarantee: only someone holding the server key can produce a
 * token; a token works for exactly one session; and checking it can neither
 * throw nor be fooled by an empty or malformed value.
 */

const KEY = "unit-test-cookie-secret-0123456789";
const SESSION = "01a109ab-af2a-71bd-9470-64034b6778fc";

describe("csrfTokenFor", () => {
  it("is stable for a session, so a reload or a second tab gets the same token", () => {
    expect(csrfTokenFor(SESSION, KEY)).toBe(csrfTokenFor(SESSION, KEY));
  });

  it("differs between sessions", () => {
    expect(csrfTokenFor(SESSION, KEY)).not.toBe(csrfTokenFor(`${SESSION}x`, KEY));
  });

  it("differs under another key, so a leaked token says nothing about other environments", () => {
    expect(csrfTokenFor(SESSION, KEY)).not.toBe(csrfTokenFor(SESSION, `${KEY}-other`));
  });

  it("is never the session cookie's own signature", () => {
    // @fastify/cookie signs the cookie with HMAC-SHA256(COOKIE_SECRET, value).
    // If the token were computed the same way, it would equal that signature.
    const cookieSignature = createHmac("sha256", KEY).update(SESSION).digest("base64url");
    const cookieSignatureB64 = createHmac("sha256", KEY)
      .update(SESSION)
      .digest("base64")
      .replace(/=+$/, "");
    const token = csrfTokenFor(SESSION, KEY);
    expect(token).not.toBe(cookieSignature);
    expect(token).not.toBe(cookieSignatureB64);
  });

  it("is header-safe base64url of a SHA-256 HMAC", () => {
    expect(csrfTokenFor(SESSION, KEY)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("csrfTokenMatches", () => {
  const token = csrfTokenFor(SESSION, KEY);

  it("accepts the session's own token", () => {
    expect(csrfTokenMatches(SESSION, KEY, token)).toBe(true);
  });

  it("rejects another session's token", () => {
    expect(csrfTokenMatches(`${SESSION}x`, KEY, token)).toBe(false);
  });

  it("rejects a token made with another key", () => {
    expect(csrfTokenMatches(SESSION, KEY, csrfTokenFor(SESSION, `${KEY}-other`))).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["truncated", token.slice(0, -1)],
    ["extended", `${token}A`],
    ["one character changed", `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`],
    ["non-ASCII", "é".repeat(43)],
  ])("rejects a %s token without throwing", (_label, presented) => {
    expect(csrfTokenMatches(SESSION, KEY, presented)).toBe(false);
  });

  it("rejects everything when there is no session id, including the token for ''", () => {
    // No cookie, or a cookie whose signature does not verify, yields "".
    expect(csrfTokenMatches("", KEY, csrfTokenFor("", KEY))).toBe(false);
    expect(csrfTokenMatches("", KEY, token)).toBe(false);
  });
});
