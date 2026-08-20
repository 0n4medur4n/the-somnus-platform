import { z } from "zod";

/**
 * BigQuery analytics export configuration (build plan §5.7 / §3.8). Unset in local
 * dev / CI, where the export is a no-op; set in staging/production, where the
 * redacted audit rows stream to BigQuery via the service account.
 */
export const AuditExportConfigSchema = z.object({
  BIGQUERY_PROJECT: z.string().default(""),
  BIGQUERY_DATASET: z.string().default(""),
  BIGQUERY_AUDIT_TABLE: z.string().default(""),
});

export type AuditExportConfig = z.infer<typeof AuditExportConfigSchema>;

export function loadAuditExportConfig(env: NodeJS.ProcessEnv = process.env): AuditExportConfig {
  const result = AuditExportConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[audit-export-config] FATAL: invalid configuration:\n${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}

export function isBigQueryConfigured(config: AuditExportConfig): boolean {
  return (
    config.BIGQUERY_PROJECT !== "" &&
    config.BIGQUERY_DATASET !== "" &&
    config.BIGQUERY_AUDIT_TABLE !== ""
  );
}
