import { ApiRequestError } from "./api.js";

/**
 * What the auth callback is allowed to tell someone when it fails.
 *
 * There are exactly two, and the split is the point. The callback effect does
 * three different things -- redeem the emailed link, exchange it for a session,
 * and load the account -- and until now any failure in any of them rendered the
 * same sentence: "your link is invalid or has expired". That sentence asserts a
 * cause. When the real failure was a 500 from the session endpoint it was simply
 * untrue, it sent the person to request another link that would fail the same
 * way, and it misdirected a CI investigation for three rounds.
 *
 * So `link-invalid` is now claimed ONLY on the Firebase Auth codes that actually
 * mean the emailed link cannot be used. Everything else is `generic`, which says
 * something went wrong without inventing a reason for it.
 */
export type CallbackFailure = "link-invalid" | "generic";

/**
 * The only codes that genuinely mean the link itself is unusable.
 *
 * Deliberately short. `auth/invalid-email` (the stored address does not match
 * the link) and `auth/user-disabled` are real failures too, but they are not the
 * link expiring, and telling someone to request a new link would send them round
 * a loop that cannot succeed. They fall through to `generic`.
 */
const LINK_FAILURE_CODES: ReadonlySet<string> = new Set([
  "auth/invalid-action-code",
  "auth/expired-action-code",
]);

/**
 * A Firebase Auth error code, if this is one.
 *
 * Structural rather than `instanceof FirebaseError`: bundlers can hand a page
 * two copies of a module, and an `instanceof` that quietly stops matching would
 * fail in the same silent direction this whole change exists to close.
 */
function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("auth/") ? code : null;
}

export function classifyCallbackFailure(error: unknown): CallbackFailure {
  const code = authErrorCode(error);
  return code !== null && LINK_FAILURE_CODES.has(code) ? "link-invalid" : "generic";
}

/**
 * A log-safe description of what went wrong.
 *
 * Never carries the callback URL, the email, or the ID token: the magic-link URL
 * has a one-time credential in its query string, and build plan §5.2 keeps
 * tokens out of anything the SPA writes down. What is left -- the stage, an
 * error code, an HTTP status -- is exactly what a person reading the console
 * needs to know which of the three steps failed.
 */
export function describeCallbackFailure(error: unknown): Record<string, unknown> {
  if (error instanceof ApiRequestError) {
    return { kind: "http", status: error.status, code: error.code, message: error.message };
  }
  const code = authErrorCode(error);
  if (code !== null) return { kind: "auth", code };
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}
