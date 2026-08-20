import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";
import { AuditDbModule } from "./db/audit-db.module.js";
import { AuditRepository } from "./db/repositories/index.js";

/**
 * The isolated Audit module (build plan §5.7 / ADR 0010). Owns `somnus_audit`
 * (via AuditDbModule); the outside world reaches it only through AuditService.
 * Separate database and state from the Notification module.
 */
@Module({
  imports: [AuditDbModule],
  controllers: [AuditController],
  providers: [
    {
      provide: AuditService,
      useFactory: (repository: AuditRepository) => new AuditService(repository),
      inject: [AuditRepository],
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
