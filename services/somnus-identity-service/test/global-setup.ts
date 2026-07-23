import { createDb, createPool } from "../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../src/infrastructure/db/db.config.js";
import { runMigrationsUp } from "../src/infrastructure/db/migrate.js";

/**
 * Runs once before the whole test run (vitest `globalSetup`), so every
 * test file -- including ones running in a fresh worker/fork -- finds
 * the schema already applied. Requires `just dev-up` (docker-compose
 * MySQL) running locally; see README.md.
 */
export default async function setup(): Promise<void> {
  const config = loadDbConfig(process.env);
  const pool = createPool(config);
  const db = createDb(pool);
  await runMigrationsUp(db);
  await pool.end();
}
