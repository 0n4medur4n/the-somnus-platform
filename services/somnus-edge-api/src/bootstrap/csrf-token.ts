import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * CSRF tokens bound to the session: the "signed double-submit" pattern from
 * the OWASP CSRF cheat sheet, with the session id as the binding.
 *
 * ## Why not a second cookie
 *
 * The API is served at `api.thesomnus.com` through Firebase Hosting, so that
 * its session cookie is first-party to `app.thesomnus.com` and
 * `console.thesomnus.com` and survives Safari, iOS in-app browsers and every
 * browser that blocks third-party cookies. Firebase Hosting forwards exactly
 * one cookie to Cloud Run -- the one named `__session` -- and strips the rest.
 * @fastify/csrf-protection kept its secret in a second cookie (`_csrf`), which
 * would never arrive. So the secret is not stored anywhere per user: the token
 * is derived from the session id, and checking it needs only the one cookie
 * Hosting lets through.
 *
 * ## Why it is safe
 *
 * The token is an HMAC of the session id under a server-only key. An attacker
 * on another site can make the browser send the session cookie, but cannot
 * read it (HttpOnly) or the token (CORS), and cannot compute the token without
 * the key. A token is useless with any other session, and dies with its own:
 * a revoked session fails the SessionGuard regardless of the token.
 *
 * The key is derived from COOKIE_SECRET rather than being COOKIE_SECRET
 * itself. @fastify/cookie signs the session cookie with an HMAC of the session
 * id under COOKIE_SECRET; computing the token the same way would make the
 * token equal the cookie's own signature. A label-specific derived key keeps
 * the two unrelated.
 */

const KEY_LABEL = "somnus/csrf-token/v1";

function derivedKey(cookieSecret: string): Buffer {
  return createHmac("sha256", cookieSecret).update(KEY_LABEL).digest();
}

/** The CSRF token for a session: base64url, stable for the session's lifetime. */
export function csrfTokenFor(sessionId: string, cookieSecret: string): string {
  return createHmac("sha256", derivedKey(cookieSecret)).update(sessionId).digest("base64url");
}

/**
 * True only when `presented` is exactly the token for `sessionId`. Constant
 * time, and false -- never a throw -- for a missing, empty or malformed value.
 * An empty session id (no cookie, or a forged one) is refused outright: the
 * HMAC of "" is a perfectly valid-looking token, and nothing should depend on
 * it merely never having been issued.
 */
export function csrfTokenMatches(
  sessionId: string,
  cookieSecret: string,
  presented: string | undefined,
): boolean {
  if (sessionId.length === 0) return false;
  if (typeof presented !== "string" || presented.length === 0) return false;
  const expected = Buffer.from(csrfTokenFor(sessionId, cookieSecret));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
