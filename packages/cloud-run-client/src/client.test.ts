import { SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import { createCloudRunClient, noRetryPolicy, type Transport } from "./client.js";
import type { HttpHeaders } from "./types.js";

const STATIC_TOKEN = "static-token";

function fakeTokenProvider(): { getIdToken: () => Promise<string>; calls: number } {
  const p = {
    calls: 0,
    async getIdToken() {
      this.calls++;
      return STATIC_TOKEN;
    },
  };
  return p;
}

function jsonTransport(
  responder: (
    url: string,
    init: { method: string; headers: HttpHeaders; body: string | undefined },
  ) => {
    status: number;
    headers: HttpHeaders;
    body: string;
  },
): Transport {
  return async ({ url, init }) => responder(url, init);
}

describe("createCloudRunClient", () => {
  it("sends Authorization and x-correlation-id and parses JSON on 2xx", async () => {
    const tp = fakeTokenProvider();
    const seen: { url: string; headers: HttpHeaders; body: string | undefined }[] = [];
    const client = createCloudRunClient({
      baseUrl: "https://morpheo.example",
      tokenProvider: tp,
      retry: noRetryPolicy,
      transport: jsonTransport((url, init) => {
        seen.push({ url, headers: init.headers, body: init.body });
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"ok":true}',
        };
      }),
    });
    const r = await client.get("/v1/ping", { correlationId: "corr-1" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(seen[0]?.url).toBe("https://morpheo.example/v1/ping");
    const h = seen[0]?.headers ?? {};
    expect(h["Authorization"]).toBe(`Bearer ${STATIC_TOKEN}`);
    expect(h["x-correlation-id"]).toBe("corr-1");
    expect(tp.calls).toBe(1);
  });

  it("serializes the body as JSON when present", async () => {
    const seen: string[] = [];
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      transport: jsonTransport((_url, init) => {
        seen.push(init.body ?? "");
        return { status: 201, headers: {}, body: "{}" };
      }),
    });
    await client.post("/v1/x", { correlationId: "c", body: { a: 1, b: "y" } });
    expect(JSON.parse(seen[0] ?? "")).toEqual({ a: 1, b: "y" });
  });

  it("encodes the query string", async () => {
    const seen: string[] = [];
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      transport: jsonTransport((url) => {
        seen.push(url);
        return { status: 200, headers: {}, body: "{}" };
      }),
    });
    await client.get("/v1/list", { correlationId: "c", query: { limit: 10, after: "abc" } });
    expect(seen[0]).toContain("limit=10");
    expect(seen[0]).toContain("after=abc");
  });

  it("maps an upstream §16 error to a SomnusError carrying the upstream details", async () => {
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      transport: jsonTransport(() => ({
        status: 401,
        headers: {},
        body: JSON.stringify({
          error: {
            code: "UNAUTHENTICATED",
            message: "no token",
            correlationId: "u-1",
            details: {},
          },
        }),
      })),
    });
    await expect(client.get("/v1/me", { correlationId: "c" })).rejects.toMatchObject({
      name: "SomnusError",
      code: "UNAUTHENTICATED",
      correlationId: "c",
    });
  });

  it("retries retriable statuses and then maps the final response to a SomnusError", async () => {
    let attempt = 0;
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: {
        maxAttempts: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        jitter: false,
      },
      transport: jsonTransport(() => {
        attempt++;
        if (attempt < 3) {
          return { status: 503, headers: {}, body: "" };
        }
        return {
          status: 404,
          headers: {},
          body: JSON.stringify({
            error: { code: "NOT_FOUND", message: "x", correlationId: "c", details: {} },
          }),
        };
      }),
    });
    await expect(client.get("/v1/me", { correlationId: "c" })).rejects.toBeInstanceOf(SomnusError);
    expect(attempt).toBe(3);
  });

  it("does not retry 4xx other than 408/425/429", async () => {
    let attempt = 0;
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: {
        maxAttempts: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        jitter: false,
      },
      transport: jsonTransport(() => {
        attempt++;
        return {
          status: 404,
          headers: {},
          body: JSON.stringify({
            error: { code: "NOT_FOUND", message: "x", correlationId: "c", details: {} },
          }),
        };
      }),
    });
    await expect(client.get("/v1/me", { correlationId: "c" })).rejects.toBeInstanceOf(SomnusError);
    expect(attempt).toBe(1);
  });

  it("retries network errors (TypeError) and then surfaces the error", async () => {
    let attempt = 0;
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: {
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        jitter: false,
      },
      transport: jsonTransport(() => {
        attempt++;
        throw new TypeError("ECONNREFUSED");
      }),
    });
    await expect(client.get("/v1/me", { correlationId: "c" })).rejects.toBeInstanceOf(TypeError);
    expect(attempt).toBe(2);
  });

  it("respects an external AbortSignal", async () => {
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      transport: async ({ init }) => {
        await new Promise<void>((resolve, reject) => {
          if (init.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          const t = setTimeout(resolve, 50);
          init.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
        return { status: 200, headers: {}, body: "{}" };
      },
    });
    const ctrl = new AbortController();
    const p = client.get("/v1/me", { correlationId: "c", signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when the upstream is a timeout and converts to SomnusError UPSTREAM_UNAVAILABLE", async () => {
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      defaultTimeoutMs: 20,
      transport: async ({ init }) => {
        await new Promise<void>((resolve, reject) => {
          if (init.signal.aborted) {
            reject(new DOMException("Timeout", "TimeoutError"));
            return;
          }
          const t = setTimeout(resolve, 100);
          init.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("Timeout", "TimeoutError"));
          }, { once: true });
        });
        return { status: 200, headers: {}, body: "{}" };
      },
    });
    await expect(client.get("/v1/slow", { correlationId: "c" })).rejects.toMatchObject({
      name: "SomnusError",
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("rejects an empty baseUrl at construction time", () => {
    expect(() =>
      createCloudRunClient({ baseUrl: "", tokenProvider: fakeTokenProvider() }),
    ).toThrow();
  });

  it("forwards custom headers from the request", async () => {
    const seen: HttpHeaders = {};
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      transport: jsonTransport((_u, init) => {
        Object.assign(seen, init.headers);
        return { status: 200, headers: {}, body: "{}" };
      }),
    });
    await client.get("/v1/me", { correlationId: "c", headers: { "x-somnus-trace": "abc" } });
    expect(seen["x-somnus-trace"]).toBe("abc");
  });

  it("omits Content-Type when no body is present", async () => {
    const seen: HttpHeaders = {};
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      transport: jsonTransport((_u, init) => {
        Object.assign(seen, init.headers);
        return { status: 200, headers: {}, body: "{}" };
      }),
    });
    await client.get("/v1/me", { correlationId: "c" });
    expect(seen["Content-Type"]).toBeUndefined();
  });

  it("propagates the source service name when configured", async () => {
    const seen: HttpHeaders = {};
    const client = createCloudRunClient({
      baseUrl: "https://x",
      tokenProvider: fakeTokenProvider(),
      retry: noRetryPolicy,
      serviceName: "somnus-edge-api",
      transport: jsonTransport((_u, init) => {
        Object.assign(seen, init.headers);
        return { status: 200, headers: {}, body: "{}" };
      }),
    });
    await client.get("/v1/me", { correlationId: "c" });
    expect(seen["x-somnus-source"]).toBe("somnus-edge-api");
  });

  it("uses the default transport and parses a 2xx JSON body end to end", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown) => {
      return new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const client = createCloudRunClient({
        baseUrl: "https://x",
        tokenProvider: fakeTokenProvider(),
        retry: noRetryPolicy,
      });
      const r = await client.get("/v1/ping", { correlationId: "c" });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ hello: "world" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns a non-JSON 2xx body as a string", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("plain text", { status: 200 })) as typeof fetch;
    try {
      const client = createCloudRunClient({
        baseUrl: "https://x",
        tokenProvider: fakeTokenProvider(),
        retry: noRetryPolicy,
      });
      const r = await client.get("/v1/text", { correlationId: "c" });
      expect(r.body).toBe("plain text");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
