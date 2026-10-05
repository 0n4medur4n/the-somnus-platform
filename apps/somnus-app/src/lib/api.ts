import { env } from "../config/env.js";

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
 * That cannot work in any deployed environment: this app is served from
 * `app.thesomnus.com` and edge-api from `*.run.app`, and a page can only read
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

/** A normalized error carrying edge-api's §16 stable `code` for i18n on the frontend. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type ApiErrorBody = { error?: { code?: string; message?: string; details?: { reason?: unknown } } };

type RawResponse = { status: number; data: unknown };

async function send(
  method: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<RawResponse> {
  const headers: Record<string, string> = { "x-correlation-id": crypto.randomUUID() };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token !== undefined) headers["x-csrf-token"] = token;

  const init: RequestInit = {
    method,
    headers,
    // The HttpOnly session cookie rides every request; the SPA never
    // reads or stores it (build plan §5.2).
    credentials: "include",
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(`${env.VITE_EDGE_API_URL}${path}`, init);
  if (response.status === 204) return { status: 204, data: undefined };
  const text = await response.text();
  return { status: response.status, data: text.length > 0 ? JSON.parse(text) : undefined };
}

function toError(raw: RawResponse): ApiRequestError {
  const err = (raw.data as ApiErrorBody | undefined)?.error;
  return new ApiRequestError(
    raw.status,
    err?.code ?? "UNKNOWN",
    err?.message ?? `Request failed (${raw.status})`,
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const needsToken = STATE_CHANGING.has(method) && path !== SESSION_CREATE;

  let raw = await send(
    method,
    path,
    body,
    needsToken ? (csrfToken ?? (await refreshToken())) : undefined,
  );

  // One retry, and only for a CSRF rejection: the token can be stale after the
  // secret cookie rotated (new browser session, logout elsewhere). A 403 that
  // means "not allowed" is never retried, and neither is a second CSRF failure.
  if (needsToken && isCsrfRejection(raw)) {
    csrfToken = undefined;
    raw = await send(method, path, body, await refreshToken());
  }

  if (raw.status < 200 || raw.status >= 300) throw toError(raw);

  if (method === "POST" && path === SESSION_CREATE) rememberToken(raw.data);
  if (method === "DELETE" && path === SESSION_DESTROY) csrfToken = undefined;
  return raw.data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>("PATCH", path, body),
  del: <T>(path: string): Promise<T> => request<T>("DELETE", path),
};
