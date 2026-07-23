import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { Pool } from "mysql2/promise";
import type { Db } from "./db.client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "migrations");

/** Applies every pending "up" migration via Drizzle's own tracked migrator. */
export async function runMigrationsUp(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/**
 * Drizzle's default tracking table name (mysql-core/dialect.ts). "down"
 * also drops this: rolling back must undo the migrator's own bookkeeping
 * too, or a later `runMigrationsUp` sees the migration hash already
 * recorded and silently skips re-running it -- "up" would report
 * success without actually recreating a single table.
 */
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Applies the hand-maintained `.down.sql` files in reverse filename
 * order, most-recent-first. Not tracked by Drizzle's migrator (down
 * migrations are not a drizzle-kit feature); intended for local dev
 * resets and the migration up/down test, not production rollback
 * automation.
 */
export async function runMigrationsDown(pool: Pool): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".down.sql"))
    .sort()
    .reverse();

  for (const file of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    // Strip `--` line comments before splitting on `;`, so a
    // multi-line comment block preceding the first statement can't
    // absorb that statement into a chunk this filters out.
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
