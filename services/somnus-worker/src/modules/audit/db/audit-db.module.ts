import { Module } from "@nestjs/common";
import { type AuditDb, createAuditDb, createAuditPool } from "./audit-db.client.js";
import { loadAuditDbConfig } from "./audit-db.config.js";
import { AuditRepository } from "./repositories/index.js";

export const AUDIT_DB = Symbol("AUDIT_DB");

/**
 * NOT `@Global()`: this connection and repository are audit-internal state. Only
 * `AuditModule` imports this module; other code reaches audit only through
 * `AuditService` (build plan ADR 0010, isolated module). It is a separate database
 * from the Notification module's — the two isolated modules share no state.
 */
@Module({
  providers: [
    {
      provide: AUDIT_DB,
      useFactory: (): AuditDb => {
        const config = loadAuditDbConfig(process.env);
        const pool = createAuditPool(config);
        return createAuditDb(pool);
      },
    },
    {
      provide: AuditRepository,
      useFactory: (db: AuditDb) => new AuditRepository(db),
      inject: [AUDIT_DB],
    },
  ],
  exports: [AUDIT_DB, AuditRepository],
})
export class AuditDbModule {}
