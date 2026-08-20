import { Module } from "@nestjs/common";
import { isBigQueryConfigured, loadAuditExportConfig } from "./audit.config.js";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";
import { AuditDbModule } from "./db/audit-db.module.js";
import { AuditRepository } from "./db/repositories/index.js";
import type { AuditExporter } from "./export/audit-exporter.js";
import { BigQueryAuditExporter, NoopAuditExporter } from "./export/bigquery-exporter.js";

export const AUDIT_EXPORTER = Symbol("AUDIT_EXPORTER");

/**
 * The isolated Audit module (build plan §5.7 / ADR 0010). Owns `somnus_audit`
 * (via AuditDbModule) and its analytics exporter; the outside world reaches it
 * only through AuditService. Separate database and state from the Notification
 * module.
 */
@Module({
  imports: [AuditDbModule],
  controllers: [AuditController],
  providers: [
    {
      provide: AUDIT_EXPORTER,
      useFactory: (): AuditExporter => {
        const config = loadAuditExportConfig(process.env);
        if (!isBigQueryConfigured(config)) {
          return new NoopAuditExporter();
        }
        return new BigQueryAuditExporter(
          config.BIGQUERY_PROJECT,
          config.BIGQUERY_DATASET,
          config.BIGQUERY_AUDIT_TABLE,
        );
      },
    },
    {
      provide: AuditService,
      useFactory: (repository: AuditRepository, exporter: AuditExporter) =>
        new AuditService(repository, exporter),
      inject: [AuditRepository, AUDIT_EXPORTER],
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
