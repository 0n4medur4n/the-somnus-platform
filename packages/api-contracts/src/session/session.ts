import { z } from "zod";

/**
 * POST /v1/sessions -- the SPA sends the Firebase ID token it just
 * obtained from Firebase Auth; the edge API verifies it and exchanges
 * it for a server-side session cookie (build plan §10). The token is
 * never stored or forwarded; only the verified identity is.
 */
export const SessionCreateRequestSchema = z
  .object({
    idToken: z.string().min(1),
  })
  .strict();
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

/**
 * The CSRF token the SPA echoes in `x-csrf-token` on every state-changing
 * request (double-submit; the matching secret lives in an HttpOnly signed
 * cookie the SPA never sees).
 *
 * It travels in a response body, not a cookie, on purpose. Until 2026-10-05 it
 * was a "readable" cookie the SPA read through `document.cookie`, which only
 * works when the SPA and the API share a host. In every deployed environment
 * they do not -- the SPA is on `app.thesomnus.com`, edge-api on `*.run.app` --
 * and a page can never read another site's cookies. The SPA therefore sent no
 * token, and every authenticated mutation, registration included, was a 403.
 * CI never saw it: there both run on `localhost`, and cookies ignore ports.
 *
 * A body is readable only by an origin CORS allows, so the token is no more
 * exposed than the cookie was meant to be.
 */
const csrfTokenSchema = z.string().min(1);

/**
 * The response never includes the session id (that lives only in the
 * HttpOnly cookie). It reports who the session belongs to and when it
 * expires, enough for the SPA to render "signed in" state, plus the CSRF
 * token for the requests that follow.
 *
 * `firebaseUid` is the verified Firebase subject, not a Somnus user id:
 * mapping the Firebase identity to a Somnus user (and composing
 * `/v1/me`) is Checkpoint 8.2, via the internal identity-service
 * client. In Checkpoint 8.1 the edge API knows only the Firebase
 * identity.
 */
export const SessionResponseSchema = z.object({
  firebaseUid: z.string().min(1),
  email: z.string().email().nullable(),
  expiresAt: z.iso.datetime(),
  csrfToken: csrfTokenSchema,
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/**
 * GET /v1/sessions/csrf -- a CSRF token for the current session.
 *
 * The SPA keeps the token in memory only, so a page reload loses it while the
 * session cookie survives. This is how it gets one back without signing in
 * again. Session-guarded, and a GET, so it is not itself CSRF-protected: a
 * cross-site page can make the browser call it but cannot read the answer.
 */
export const CsrfTokenResponseSchema = z.object({
  csrfToken: csrfTokenSchema,
});
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponseSchema>;
