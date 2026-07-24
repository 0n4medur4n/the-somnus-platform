import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { Pool } from "mysql2/promise";
import type { ConsentDb } from "./consent-db.client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * Consent's own migrations folder, separate from identity's
 * (`services/somnus-identity-service/migrations/`) -- build plan §13 /
 * ADR 0010: own logical database, own independent migration history.
 */
export const CONSENT_MIGRATIONS_DIR = join(__dirname, "..", "migrations");

export async function runConsentMigrationsUp(db: ConsentDb): Promise<void> {
  await migrate(db, { migrationsFolder: CONSENT_MIGRATIONS_DIR });
}

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

/** Same down-migration convention as identity's migrate.ts: hand-maintained .down.sql, reverse order, drops the migrator's own tracking table too. */
export async function runConsentMigrationsDown(pool: Pool): Promise<void> {
  const files = (await readdir(CONSENT_MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".down.sql"))
    .sort()
    .reverse();

  for (const file of files) {
    const raw = await readFile(join(CONSENT_MIGRATIONS_DIR, file), "utf-8");
    const withoutComments = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = withoutComments
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pool.query(statement);
    }
  }

  await pool.query(`DROP TABLE IF EXISTS \`${DRIZZLE_MIGRATIONS_TABLE}\``);
}
