import { createDb, createPool } from "../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../src/infrastructure/db/db.config.js";
import { runMigrationsUp } from "../src/infrastructure/db/migrate.js";
import { createConsentDb, createConsentPool } from "../src/modules/consent/db/consent-db.client.js";
import { loadConsentDbConfig } from "../src/modules/consent/db/consent-db.config.js";
import { runConsentMigrationsUp } from "../src/modules/consent/db/migrate.js";

/**
 * Runs once before the whole test run (vitest `globalSetup`), so every
 * test file -- including ones running in a fresh worker/fork -- finds
 * the schema already applied. Requires `just dev-up` (docker-compose
 * MySQL) running locally; see README.md.
 *
 * Two independent databases, two independent migration runs (build
 * plan §13 / ADR 0010: consent's migration history is genuinely
 * separate from identity's, not just a different folder read by the
 * same runner).
 */
export default async function setup(): Promise<void> {
  const config = loadDbConfig(process.env);
  const pool = createPool(config);
  const db = createDb(pool);
  await runMigrationsUp(db);
  await pool.end();

  const consentConfig = loadConsentDbConfig(process.env);
  const consentPool = createConsentPool(consentConfig);
  const consentDb = createConsentDb(consentPool);
  await runConsentMigrationsUp(consentDb);
  await consentPool.end();
}
