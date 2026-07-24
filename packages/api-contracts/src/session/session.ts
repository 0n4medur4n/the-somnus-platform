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
 * The response never includes the session id (that lives only in the
 * HttpOnly cookie) or the CSRF token value (returned via a separate
 * readable cookie). It reports who the session belongs to and when it
 * expires, enough for the SPA to render "signed in" state.
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
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
