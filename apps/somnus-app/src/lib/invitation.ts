/**
 * The invitation token, parked while the invited person completes the magic
 * link (Addendum A Checkpoint 14.2). Nox has no public signup, so the accept
 * flow has to survive a round trip through the user's inbox and a fresh page
 * load on `/auth/callback`.
 *
 * sessionStorage, not localStorage: it dies with the tab. It creates no new
 * secret either -- this is the same token already sitting in the URL of the
 * email the person just opened. It is cleared as soon as the invitation is
 * accepted or found unusable. No Firebase token is ever stored anywhere
 * (build plan §5.2; the no-token-storage test asserts it).
 *
 * Every accessor is guarded: storage throws in a private window with site data
 * blocked, and losing the token must degrade to "open the emailed link again",
 * never to a crash or to open registration.
 */
const KEY = "somnus_pending_invitation";

export function rememberInvitation(token: string): void {
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable: the emailed link still carries the token */
  }
}

export function pendingInvitation(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInvitation(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}
