/** One-off Cloud Run Job entry point. Secret values are mounted by reference. */
import { createDb, createPool } from "./infrastructure/db/db.client.js";
import { loadDbConfig } from "./infrastructure/db/db.config.js";
import { runMigrationsUp } from "./infrastructure/db/migrate.js";

async function migrateIdentity(): Promise<void> {
  if (!process.env["DATABASE_URL"]) throw new Error("Migration database configuration required.");
  const pool = createPool({ ...loadDbConfig(process.env), DB_POOL_SIZE: 1 });
  try {
    await runMigrationsUp(createDb(pool));
    process.stdout.write('{"operation":"identity_migration","status":"complete"}\n');
  } finally {
    await pool.end();
  }
}
void migrateIdentity().catch(() => {
  // Driver errors may include a connection string or SQL parameters.
  process.stderr.write('{"operation":"identity_migration","status":"failed"}\n');
  process.exitCode = 1;
});
