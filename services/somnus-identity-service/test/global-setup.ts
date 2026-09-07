import type { Pool } from "mysql2/promise";
import { createDb, createPool } from "../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../src/infrastructure/db/db.config.js";
import { runMigrationsUp } from "../src/infrastructure/db/migrate.js";
import { createConsentDb, createConsentPool } from "../src/modules/consent/db/consent-db.client.js";
import { loadConsentDbConfig } from "../src/modules/consent/db/consent-db.config.js";
import { runConsentMigrationsUp } from "../src/modules/consent/db/migrate.js";
import { assertDestructiveTargetAllowed, assertTargetsAreDistinct } from "./destructive-guard.js";

/**
 * Drops every table in the pool's current database, Drizzle's
 * `__drizzle_migrations` journal included. Generic (reads
 * `information_schema`) so it is safe on an empty, a fully-migrated, or a
 * half-migrated database alike -- unlike the `.down.sql` runners, whose
 * seed-deletes assume the tables already exist. `DATABASE()` scopes it to
 * the connected logical database only, so identity never touches consent
 * and vice versa (ADR 0010).
 */
async function dropAllTables(pool: Pool): Promise<void> {
  const [rows] = await pool.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  const names = (rows as unknown as Array<{ name: string }>).map((r) => r.name);
  if (names.length === 0) return;
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const name of names) {
    await pool.query(`DROP TABLE IF EXISTS \`${name}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
}

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
 *
 * Guarded first: `assertDestructiveTargetAllowed` refuses anything that is not
 * a disposable target, before a pool is opened. See destructive-guard.ts for
 * why a secret's name in one workflow line was not a control.
 *
 * Clean slate first: the CI TiDB cluster is shared and persistent, and
 * `globalSetup` has no teardown, so a previous run that crashed mid-test
 * (e.g. on a serverless connection flake) leaves its tables behind. On
 * the next run `migrate()` then collides with the existing schema
 * (`ER_TABLE_EXISTS_ERROR`) and every run stays red. Dropping all tables
 * before migrating makes each run self-heal from any leftover state.
 */
export default async function setup(): Promise<void> {
  const config = loadDbConfig(process.env);
  const consentConfig = loadConsentDbConfig(process.env);

  // BOTH targets are checked before a single pool is opened. Checking each one
  // just before its own drop would still let a run that is half-legitimate
  // destroy the identity database and only then refuse the consent one; a
  // partial wipe is not a safer outcome than a refusal.
  assertDestructiveTargetAllowed(config.DATABASE_URL, "identity");
  assertDestructiveTargetAllowed(consentConfig.CONSENT_DATABASE_URL, "consent");

  // Both targets can be individually legitimate and still be the same database,
  // in which case the consent pass below wipes what the identity pass just
  // migrated. Checked here, before any pool, for the same reason as above.
  assertTargetsAreDistinct(config.DATABASE_URL, consentConfig.CONSENT_DATABASE_URL);

  const pool = createPool(config);
  const db = createDb(pool);
  await dropAllTables(pool);
  await runMigrationsUp(db);
  await pool.end();

  const consentPool = createConsentPool(consentConfig);
  const consentDb = createConsentDb(consentPool);
  await dropAllTables(consentPool);
  await runConsentMigrationsUp(consentDb);
  await consentPool.end();
}
