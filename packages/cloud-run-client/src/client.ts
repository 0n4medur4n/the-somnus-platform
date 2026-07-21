import { mapHttpErrorToSomnusError } from "./error-mapping.js";
import {
  computeBackoffMs,
  defaultRetryPolicy,
  isRetriableHttpStatus,
  isRetriableNetworkError,
  noRetryPolicy,
  type RetryPolicy,
  sleep,
} from "./retry.js";
import type { HttpHeaders, HttpMethod, HttpResponse, RequestOptions, Transport } from "./types.js";

export type TokenProvider = {
  getIdToken(): Promise<string>;
};

export type ClientOptions = {
  baseUrl: string;
  tokenProvider: TokenProvider;
  retry?: RetryPolicy;
  defaultTimeoutMs?: number;
  transport?: Transport;
  serviceName?: string;
};

export type CloudRunClient = {
  request<T = unknown>(options: RequestOptions): Promise<HttpResponse<T>>;
  get<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>>;
  post<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>>;
  put<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>>;
  patch<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>>;
  delete<T = unknown>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>>;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export function createCloudRunClient(options: ClientOptions): CloudRunClient {
  if (!options.baseUrl) {
    throw new Error("createCloudRunClient requires a non-empty baseUrl");
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const retry: RetryPolicy = options.retry ?? defaultRetryPolicy;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport: Transport = options.transport ?? defaultTransport();

  async function send<T>(req: RequestOptions, method: HttpMethod): Promise<HttpResponse<T>> {
    const url = buildUrl(baseUrl, req.path, req.query);
    const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;
    const headers = await buildHeaders(req, options.tokenProvider, options.serviceName);
    const body = req.body === undefined ? undefined : JSON.stringify(req.body);

    let lastError: unknown = null;
    for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
      const controller = new AbortController();
      const signal = mergeSignals(req.signal, controller.signal);
      const timer = setTimeout(
        () => controller.abort(new DOMException("Timeout", "TimeoutError")),
        timeoutMs,
      );
      const startedAt = Date.now();
      try {
        const result = await transport({
          url,
          init: {
            method,
            headers,
            body,
            signal,
          },
        });
        clearTimeout(timer);
        const parsed = parseJsonBody(result.body);
        const httpResp: HttpResponse<unknown> = {
          status: result.status,
          headers: result.headers,
          body: parsed,
          durationMs: Date.now() - startedAt,
        };
        if (httpResp.status >= 200 && httpResp.status < 300) {
          return httpResp as HttpResponse<T>;
        }
        if (
          req.skipRetry ||
          !isRetriableHttpStatus(httpResp.status) ||
          attempt === retry.maxAttempts - 1
        ) {
          throw mapHttpErrorToSomnusError(httpResp.status, httpResp.body, {
            correlationId: req.correlationId,
            fallbackMessage: `Upstream returned ${httpResp.status}`,
            url,
          });
        }
        lastError = httpResp;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const shouldRetry =
          !req.skipRetry && attempt < retry.maxAttempts - 1 && isRetriableNetworkError(err);
        if (!shouldRetry) {
          const isAbort =
            err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
          const isUserAbort = req.signal?.aborted === true;
          if (isAbort && isUserAbort) {
            // User cancelled the request; propagate the original DOMException
            // so the caller can distinguish cancellation from a real timeout.
            throw err;
          }
          if (isAbort) {
            const { SomnusError } = await import("@somnus/errors");
            throw new SomnusError(
              "UPSTREAM_UNAVAILABLE",
              `Upstream timed out after ${timeoutMs}ms`,
              { correlationId: req.correlationId, details: { url, timeoutMs }, cause: err },
            );
          }
          throw err;
        }
      }
      const delay = computeBackoffMs(retry, attempt);
      if (req.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await sleep(delay, req.signal);
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("cloud-run-client: exhausted retries without a recorded error");
  }

  function get<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>> {
    return send<T>({ ...options, method: "GET", path }, "GET");
  }
  function post<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>> {
    return send<T>({ ...options, method: "POST", path }, "POST");
  }
  function put<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>> {
    return send<T>({ ...options, method: "PUT", path }, "PUT");
  }
  function patch<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>> {
    return send<T>({ ...options, method: "PATCH", path }, "PATCH");
  }
  function del<T>(
    path: string,
    options: Omit<RequestOptions, "method" | "path">,
  ): Promise<HttpResponse<T>> {
    return send<T>({ ...options, method: "DELETE", path }, "DELETE");
  }

  return {
    request: (o) => send(o, (o.method ?? "GET") as HttpMethod),
    get,
    post,
    put,
    patch,
    delete: del,
  };
}

async function buildHeaders(
  req: RequestOptions,
  tokenProvider: TokenProvider,
  serviceName?: string,
): Promise<HttpHeaders> {
  const token = await tokenProvider.getIdToken();
  const h: HttpHeaders = {
    Authorization: `Bearer ${token}`,
    "x-correlation-id": req.correlationId,
    Accept: "application/json",
  };
  if (req.body !== undefined) {
    h["Content-Type"] = "application/json";
  }
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    h[k] = v;
  }
  if (serviceName) {
    h["x-somnus-source"] = serviceName;
  }
  return h;
}

function buildUrl(
  base: string,
  path: string,
  query: Record<string, string | number | boolean | undefined> | undefined,
): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!query) return `${base}${cleanPath}`;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs.length > 0 ? `${base}${cleanPath}?${qs}` : `${base}${cleanPath}`;
}

function mergeSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const present = signals.filter((s): s is AbortSignal => Boolean(s));
  if (present.length === 0) return new AbortController().signal;
  if (present.length === 1) {
    const first = present[0];
    if (first) return first;
    return new AbortController().signal;
  }
  const controller = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function parseJsonBody(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function defaultTransport(): Transport {
  // Real fetch is only used in production. Tests inject a fake transport.
  // We avoid the global `fetch` typing edge cases by wrapping it here.
  return async ({ url, init }) => {
    const f = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) {
      throw new Error("cloud-run-client: no fetch implementation available");
    }
    const r = await f(url, init as RequestInit);
    const headers: HttpHeaders = {};
    r.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const body = await r.text();
    return { status: r.status, headers, body };
  };
}

// Re-export for tests
export { noRetryPolicy };
