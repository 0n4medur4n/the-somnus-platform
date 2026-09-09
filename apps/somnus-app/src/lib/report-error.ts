/**
 * The SPA's error-logging path.
 *
 * There was none, and that absence is half of why a single failing sign-in took
 * three rounds of CI to localise: the screen asserted one cause, and nothing
 * anywhere recorded the real one. A Playwright trace should not be the only
 * place a production failure is visible.
 *
 * `console.error` is the entire implementation, on purpose. It is what a
 * browser console shows, what Playwright captures in its trace, and what CI
 * prints; choosing and wiring a reporting SDK is a decision with its own privacy
 * questions, and this checkpoint does not get to make it. The seam is here for
 * when it does.
 *
 * (`noConsole` is not enabled in this repo, so there is no suppression to
 * write here -- the deliberateness lives in this comment instead.)
 *
 * Callers pass only log-safe detail. Never a token, a cookie, an email address,
 * or a magic-link URL -- that URL carries a one-time credential in its query
 * string (build plan §5.2).
 */
export function reportError(where: string, detail: Record<string, unknown>): void {
  console.error(`[somnus] ${where}`, detail);
}
