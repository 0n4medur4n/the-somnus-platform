import { Module } from "@nestjs/common";
import { type ConsentDb, createConsentDb, createConsentPool } from "./consent-db.client.js";
import { loadConsentDbConfig } from "./consent-db.config.js";
import {
  ConsentAuditRepository,
  ConsentPurposesRepository,
  ConsentReceiptsRepository,
  ConsentWithdrawalsRepository,
  LegalDocumentsRepository,
} from "./repositories/index.js";

export const CONSENT_DB = Symbol("CONSENT_DB");

/**
 * Deliberately NOT `@Global()`, unlike identity's DbModule: this
 * connection and these repositories are consent-internal state. Only
 * `ConsentModule` imports this module; nothing outside
 * `src/modules/consent/` may reach `CONSENT_DB` or these repository
 * classes directly (enforced by `.dependency-cruiser.cjs`, verified by
 * `test/architecture/consent-isolation.test.ts`) -- identity code
 * reaches consent only through `ConsentService` (build plan ADR 0010).
 */
@Module({
  providers: [
    {
      provide: CONSENT_DB,
      useFactory: (): ConsentDb => {
        const config = loadConsentDbConfig(process.env);
        const pool = createConsentPool(config);
        return createConsentDb(pool);
      },
    },
    {
      provide: ConsentPurposesRepository,
      useFactory: (db: ConsentDb) => new ConsentPurposesRepository(db),
      inject: [CONSENT_DB],
    },
    {
      provide: LegalDocumentsRepository,
      useFactory: (db: ConsentDb) => new LegalDocumentsRepository(db),
      inject: [CONSENT_DB],
    },
    {
      provide: ConsentReceiptsRepository,
      useFactory: (db: ConsentDb) => new ConsentReceiptsRepository(db),
      inject: [CONSENT_DB],
    },
    {
      provide: ConsentWithdrawalsRepository,
      useFactory: (db: ConsentDb) => new ConsentWithdrawalsRepository(db),
      inject: [CONSENT_DB],
    },
    {
      provide: ConsentAuditRepository,
      useFactory: (db: ConsentDb) => new ConsentAuditRepository(db),
      inject: [CONSENT_DB],
    },
  ],
  exports: [
    CONSENT_DB,
    ConsentPurposesRepository,
    LegalDocumentsRepository,
    ConsentReceiptsRepository,
    ConsentWithdrawalsRepository,
    ConsentAuditRepository,
  ],
})
export class ConsentDbModule {}
