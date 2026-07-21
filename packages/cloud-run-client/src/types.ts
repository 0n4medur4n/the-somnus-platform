export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpHeaders = Record<string, string>;

export type HttpResponse<T = unknown> = {
  status: number;
  headers: HttpHeaders;
  body: T;
  durationMs: number;
};

export type RequestOptions = {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: HttpHeaders;
  body?: unknown;
  correlationId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  skipRetry?: boolean;
};

export type Transport = (args: {
  url: string;
  init: {
    method: string;
    headers: HttpHeaders;
    body: string | undefined;
    signal: AbortSignal;
  };
}) => Promise<{ status: number; headers: HttpHeaders; body: string }>;
