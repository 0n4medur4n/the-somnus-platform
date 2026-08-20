import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditExportRow } from "../src/modules/audit/export/audit-exporter.js";
import {
  BigQueryAuditExporter,
  NoopAuditExporter,
} from "../src/modules/audit/export/bigquery-exporter.js";

const row: AuditExportRow = {
  eventId: "e1",
  eventType: "identity.user.created.v1",
  occurredAt: "2026-08-20T12:00:00Z",
  producer: "identity-service",
  correlationId: "c",
  actorType: "user",
  subjectType: "user",
  data: { route: "signup" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(insertResponse: { ok: boolean; status: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("metadata.google.internal")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok-123" }) };
    }
    return {
      ok: insertResponse.ok,
      status: insertResponse.status,
      json: async () => insertResponse.body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("BigQueryAuditExporter", () => {
  it("fetches a token then streams the row into insertAll", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: {} });
    await new BigQueryAuditExporter("proj", "ds", "audit").export(row);

    const insertCall = fetchMock.mock.calls.find(([url]) => String(url).includes("bigquery"));
    expect(insertCall).toBeDefined();
    const [url, init] = insertCall as [string, RequestInit];
    expect(url).toContain("/projects/proj/datasets/ds/tables/audit/insertAll");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-123");
    expect(String(init.body)).toContain("signup");
  });

  it("throws on a non-2xx insert", async () => {
    stubFetch({ ok: false, status: 500, body: {} });
    await expect(new BigQueryAuditExporter("p", "d", "t").export(row)).rejects.toThrow("500");
  });

  it("throws when insertAll reports row errors", async () => {
    stubFetch({ ok: true, status: 200, body: { insertErrors: [{ index: 0 }] } });
    await expect(new BigQueryAuditExporter("p", "d", "t").export(row)).rejects.toThrow();
  });

  it("the no-op exporter resolves without a sink", async () => {
    await expect(new NoopAuditExporter().export(row)).resolves.toBeUndefined();
  });
});
