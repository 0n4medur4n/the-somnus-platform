/**
 * Which requests the CSRF gate turned away.
 *
 * The SPA needs to tell a CSRF rejection (its in-memory token is stale or
 * missing: fetch a fresh one, retry once) from a 403 that means "not allowed"
 * (never retry). The rejection itself cannot say so by the time the exception
 * filter sees it: a 403 sent from a Fastify hook reaches Nest's filter as a
 * bare `HttpException(403)`, whatever error it started as. Matching on its
 * message would break silently the day someone rewords it.
 *
 * So the gate records the fact where it happens instead (bootstrap/harden.ts).
 * Before the check runs the request is marked pending; only a token that
 * verifies clears the mark. A request that reaches the exception filter still
 * marked was rejected by the CSRF check, and by nothing else.
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
