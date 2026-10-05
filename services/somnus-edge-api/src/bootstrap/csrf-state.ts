/**
 * Which requests the CSRF gate turned away.
 *
 * The SPA needs to tell a CSRF rejection (its in-memory token is stale or
 * missing: fetch a fresh one, retry once) from a 403 that means "not allowed"
 * (never retry). The rejection itself cannot say so by the time the exception
 * filter sees it: @fastify/csrf-protection rejects with an error carrying
 * `code: "FST_CSRF_*"`, but Nest turns that into a plain `HttpException(403)`
 * with only the plugin's English message, and the code is gone. Matching on
 * that message would break silently the day the plugin rewords it.
 *
 * So the gate records the fact where it happens instead. Before the check runs
 * the request is marked pending; the plugin calls `next()` only when the token
 * verifies, and that clears the mark. A request that reaches the exception
 * filter still marked was rejected by the CSRF check, and by nothing else.
 *
 * A WeakSet, so a request object never outlives its own lifetime here.
 */
const pendingCsrfCheck = new WeakSet<object>();

/** The CSRF check is about to run for this request. */
export function markCsrfCheckPending(request: object): void {
  pendingCsrfCheck.add(request);
}

/** The CSRF check passed. */
export function markCsrfCheckPassed(request: object): void {
  pendingCsrfCheck.delete(request);
}

/** True when this request was stopped by the CSRF check. */
export function wasRejectedByCsrf(request: object): boolean {
  return pendingCsrfCheck.has(request);
}
