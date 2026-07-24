import {
  type ConsentDb,
  createConsentDb,
  createConsentPool,
} from "../../src/modules/consent/db/consent-db.client.js";
import { loadConsentDbConfig } from "../../src/modules/consent/db/consent-db.config.js";
import * as schema from "../../src/modules/consent/db/schema/index.js";

let pool: ReturnType<typeof createConsentPool> | undefined;
let db: ConsentDb | undefined;

/** One pool per test process, mirroring test/integration/db-test-helper.ts's identity-side pattern. */
export function getConsentTestDb(): ConsentDb {
  if (!db) {
    const config = loadConsentDbConfig(process.env);
    pool = createConsentPool(config);
    db = createConsentDb(pool);
  }
  return db;
}

const TABLES_IN_DELETE_ORDER = [
  schema.consentAuditEvents,
  schema.consentWithdrawals,
  schema.consentReceipts,
  // consentPurposes, legalDocuments, and legalDocumentVersions are
  // deliberately NOT reset: migration 0001_seed_consent_purposes.sql
  // seeds the fixed build plan §13 catalog once, the same way
  // identity's `roles` table is preserved between tests.
];

export async function resetConsentTables(): Promise<void> {
  const database = getConsentTestDb();
  for (const table of TABLES_IN_DELETE_ORDER) {
    await database.delete(table);
  }
}

export async function closeConsentTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
