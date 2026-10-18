import { env } from "../config/env.js";
import { SAME_ORIGIN } from "../config/env-schema.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Establishes the session; CSRF-exempt on the server, and where the first token comes from. */
const SESSION_CREATE = "/v1/sessions";
/** Re-issues a token for the current session, e.g. after a reload. */
const CSRF_TOKEN = "/v1/sessions/csrf";
/** Revokes the session; the token dies with it. */
const SESSION_DESTROY = "/v1/sessions/current";

/**
 * The CSRF token, held in memory only.
 *
 * It used to be read from a `somnus_csrf` cookie through `document.cookie`.
 * That cannot work in any deployed environment: the console is served from
 * `console.thesomnus.com` and edge-api from `*.run.app`, and a page can only read
 * cookies of its own site. The header was never sent, and every authenticated
 * mutation -- registration included -- was rejected with 403 (2026-10-05).
 * Local runs never showed it, because there both are on `localhost`.
 *
 * Now edge-api returns the token in the body of `POST /v1/sessions` and
 * `GET /v1/sessions/csrf`, and this module is the only place that holds it.
 * Not in localStorage or sessionStorage: memory is enough, because a lost token
 * is simply fetched again.
 */
let csrfToken: string | undefined;

/**
 * Set once `GET /v1/sessions/csrf` has answered 401: there is no session, so
 * asking again before every request would only double the traffic of the
 * anonymous flows (the assessment, the invitation preview). Cleared when a
 * session is created; set again on logout.
 */
let knownSignedOut = false;

/** A normalized error carrying edge-api's §16 stable `code` for i18n on the frontend. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** A feature's own stable refusal (e.g. the Drive's `drive_last_owner`), when it gave one. */
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type ApiErrorBody = { error?: { code?: string; message?: string; details?: { reason?: unknown } } };

type RawResponse = { status: number; data: unknown };

/** "" when the API is same-origin (a relative `/v1/...` request), else the configured base URL. */
function apiBase(): string {
  return env.VITE_EDGE_API_URL === SAME_ORIGIN ? "" : env.VITE_EDGE_API_URL;
}

async function send(
  method: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<RawResponse> {
  const headers: Record<string, string> = { "x-correlation-id": crypto.randomUUID() };
  const raw = body instanceof Uint8Array;
  if (body !== undefined)
    headers["content-type"] = raw ? "application/octet-stream" : "application/json";
  if (token !== undefined) headers["x-csrf-token"] = token;

  const init: RequestInit = {
    method,
    headers,
    // The HttpOnly session cookie rides every request; the SPA never
    // reads or stores it (build plan §5.2).
    credentials: "include",
    // Always ask the server: an answer about who is signed in must never come
    // from the browser's cache (edge-api also sends no-store; this covers a
    // proxy that adds a cache lifetime of its own).
    cache: "no-store",
  };
  if (body !== undefined)
    init.body = raw ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body);

  const response = await fetch(`${apiBase()}${path}`, init);
  if (response.status === 204) return { status: 204, data: undefined };
  const text = await response.text();
  if (text.length === 0) return { status: response.status, data: undefined };
  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch {
    // Not an API answer at all -- typically the console's own index.html, served
    // by Hosting for a path it does not forward to edge-api. Reading it as "no
    // session" is how sign-in once failed silently (2026-10-18); it is a
    // gateway failure, and says so.
    return { status: 502, data: { error: { code: "NON_JSON_RESPONSE" } } };
  }
}

function toError(raw: RawResponse): ApiRequestError {
  const err = (raw.data as ApiErrorBody | undefined)?.error;
  const reason = err?.details?.reason;
  return new ApiRequestError(
    raw.status,
    err?.code ?? "UNKNOWN",
    err?.message ?? `Request failed (${raw.status})`,
    typeof reason === "string" ? reason : undefined,
  );
}

/** A 403 that edge-api marks as a CSRF rejection: a stale or missing token, not "not allowed". */
function isCsrfRejection(raw: RawResponse): boolean {
  return (
    raw.status === 403 && (raw.data as ApiErrorBody | undefined)?.error?.details?.reason === "csrf"
  );
}

function rememberToken(data: unknown): void {
  const token = (data as { csrfToken?: unknown } | undefined)?.csrfToken;
  if (typeof token === "string" && token.length > 0) csrfToken = token;
}

/** Fetch a token for the current session. Throws (typically 401) when there is no session. */
async function refreshToken(): Promise<string> {
  const raw = await send("GET", CSRF_TOKEN, undefined);
  if (raw.status < 200 || raw.status >= 300) throw toError(raw);
  rememberToken(raw.data);
  if (csrfToken === undefined)
    throw new ApiRequestError(raw.status, "UNKNOWN", "No CSRF token issued");
  return csrfToken;
}

/**
 * The token to send with a mutation, or none.
 *
 * "None" is a valid answer, not a failure. Some mutations are deliberately
 * CSRF-exempt on the server because they happen before any session exists --
 * the anonymous assessment, the invitation preview -- and must go out with no
 * token at all. Which routes those are is the server's decision and is not
 * repeated here: a mutation sent without a token that did need one comes back
 * as a CSRF rejection, and `request` then fetches a token and retries.
 */
async function tokenForMutation(): Promise<string | undefined> {
  if (csrfToken !== undefined) return csrfToken;
  if (knownSignedOut) return undefined;
  try {
    return await refreshToken();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) knownSignedOut = true;
    return undefined;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const needsToken = STATE_CHANGING.has(method) && path !== SESSION_CREATE;

  let raw = await send(method, path, body, needsToken ? await tokenForMutation() : undefined);

  // One retry, and only for a CSRF rejection: the token was missing or stale
  // (a reload, a new browser session, a logout elsewhere). A 403 that means
  // "not allowed" is never retried, and neither is a second CSRF failure. If
  // there is no session, `refreshToken` throws the 401 that says so.
  if (needsToken && isCsrfRejection(raw)) {
    csrfToken = undefined;
    knownSignedOut = false;
    raw = await send(method, path, body, await refreshToken());
  }

  if (raw.status < 200 || raw.status >= 300) throw toError(raw);

  if (method === "POST" && path === SESSION_CREATE) {
    rememberToken(raw.data);
    knownSignedOut = false;
  }
  if (method === "DELETE" && path === SESSION_DESTROY) {
    csrfToken = undefined;
    knownSignedOut = true;
  }
  return raw.data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>("PATCH", path, body),
  del: <T>(path: string): Promise<T> => request<T>("DELETE", path),
  /** Raw bytes as `application/octet-stream`: the Drive's encrypted blocks. */
  putBytes: (path: string, bytes: Uint8Array): Promise<void> => request<void>("PUT", path, bytes),
};
