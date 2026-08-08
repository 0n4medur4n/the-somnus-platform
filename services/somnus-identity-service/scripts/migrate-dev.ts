/**
 * Applies the identity + consent migrations to a local/CI MySQL, standalone
 * (build plan §13 / ADR 0010: two independent logical databases, two
 * independent migration histories). Mirrors test/global-setup.ts, but as a
 * script so `just dev-up` and the E2E CI job can migrate a fresh MySQL
 * before the stack starts. Run from source via @swc-node/register so the
 * migrate helpers resolve their .sql folders (which are not copied to dist).
 * DB URLs come from the environment; defaults target docker/CI MySQL.
 */
import { createDb, createPool } from "../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../src/infrastructure/db/db.config.js";
import { runMigrationsUp } from "../src/infrastructure/db/migrate.js";
import { createConsentDb, createConsentPool } from "../src/modules/consent/db/consent-db.client.js";
import { loadConsentDbConfig } from "../src/modules/consent/db/consent-db.config.js";
import { runConsentMigrationsUp } from "../src/modules/consent/db/migrate.js";

const identityPool = createPool(loadDbConfig(process.env));
await runMigrationsUp(createDb(identityPool));
await identityPool.end();
console.warn("[migrate] somnus_identity migrated");

const consentPool = createConsentPool(loadConsentDbConfig(process.env));
await runConsentMigrationsUp(createConsentDb(consentPool));
await consentPool.end();
console.warn("[migrate] somnus_consent migrated");
