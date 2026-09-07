import { env } from "../config/env.js";

/** Readable CSRF cookie edge-api issues on login; echoed on state-changing calls (double-submit). */
const CSRF_COOKIE = "somnus_csrf";
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

type ApiErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-correlation-id": crypto.randomUUID() };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (STATE_CHANGING.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  const init: RequestInit = {
    method,
    headers,
    // The HttpOnly session cookie rides every request; the SPA never
    // reads or stores it (build plan §5.2).
    credentials: "include",
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(`${env.VITE_EDGE_API_URL}${path}`, init);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    throw new ApiRequestError(
      response.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? `Request failed (${response.status})`,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>("PATCH", path, body),
  del: <T>(path: string): Promise<T> => request<T>("DELETE", path),
};
