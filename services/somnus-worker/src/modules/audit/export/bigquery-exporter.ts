import type { AuditExporter, AuditExportRow } from "./audit-exporter.js";

/**
 * A no-op exporter used when BigQuery is not configured (local dev / CI). The
 * redaction still runs upstream; there is simply no sink.
 */
export class NoopAuditExporter implements AuditExporter {
  async export(_row: AuditExportRow): Promise<void> {
    // Intentionally empty: no export sink configured.
  }
}

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/**
 * Streams a redacted audit row into BigQuery via the REST `insertAll` API, using
 * the Cloud Run service account token from the metadata server (no SDK, mirroring
 * the Brevo-over-fetch adapter). Mocked in tests via the AuditExporter interface;
 * never constructed unless BigQuery is configured.
 */
export class BigQueryAuditExporter implements AuditExporter {
  constructor(
    private readonly project: string,
    private readonly dataset: string,
    private readonly table: string,
  ) {}

  async export(row: AuditExportRow): Promise<void> {
    const token = await this.accessToken();
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.project}/datasets/${this.dataset}/tables/${this.table}/insertAll`;
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ rows: [{ insertId: row.eventId, json: row }] }),
    });
    if (!response.ok) {
      throw new Error(`bigquery insert failed: ${response.status}`);
    }
    const body = (await response.json()) as { insertErrors?: unknown[] };
    if (body.insertErrors && body.insertErrors.length > 0) {
      throw new Error("bigquery insert reported row errors");
    }
  }

  private async accessToken(): Promise<string> {
    const response = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
    const body = (await response.json()) as { access_token?: string };
    return body.access_token ?? "";
  }
}
