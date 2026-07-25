import {
  type CloudRunClient,
  createCloudRunClient,
  type RetryPolicy,
} from "@somnus/cloud-run-client";

/** A request the fake identity transport observed, for assertions. */
export type RecordedRequest = {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: string | undefined;
};

export type ScriptedResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Responder = (req: RecordedRequest) => ScriptedResponse | Promise<ScriptedResponse>;

/**
 * A real `CloudRunClient` (so the actual OIDC-header wiring, retry, and
 * error-mapping run) backed by a fake transport the test drives. This
 * is how the edge <-> identity contract is exercised without a live
 * identity service: assert on `requests` for what edge sent, script
 * `responder` for what identity returns.
 */
export function makeFakeIdentityClient(
  responder: Responder,
  options: { retry?: RetryPolicy; defaultTimeoutMs?: number } = {},
): { client: CloudRunClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const client = createCloudRunClient({
    baseUrl: "http://identity.internal",
    tokenProvider: { getIdToken: async () => "test-token" },
    ...(options.retry ? { retry: options.retry } : {}),
    ...(options.defaultTimeoutMs ? { defaultTimeoutMs: options.defaultTimeoutMs } : {}),
    transport: async ({ url, init }) => {
      const path = new URL(url).pathname;
      const rec: RecordedRequest = {
        method: init.method,
        url,
        path,
        headers: init.headers,
        body: init.body,
      };
      requests.push(rec);
      const res = await responder(rec);
      return {
        status: res.status,
        headers: res.headers ?? {},
        body: res.body === undefined ? "" : JSON.stringify(res.body),
      };
    },
  });
  return { client, requests };
}
