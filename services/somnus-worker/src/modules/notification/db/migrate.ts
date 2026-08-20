import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { Pool } from "mysql2/promise";
import type { NotificationDb } from "./notification-db.client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** The Notification module's own migrations folder (own history, ADR 0010). */
export const NOTIFICATION_MIGRATIONS_DIR = join(__dirname, "..", "migrations");

export async function runNotificationMigrationsUp(db: NotificationDb): Promise<void> {
  await migrate(db, { migrationsFolder: NOTIFICATION_MIGRATIONS_DIR });
}

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

/** Hand-maintained `.down.sql`, reverse order; drops the migrator's tracking table too. */
export async function runNotificationMigrationsDown(pool: Pool): Promise<void> {
  const files = (await readdir(NOTIFICATION_MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".down.sql"))
    .sort()
    .reverse();

  for (const file of files) {
    const raw = await readFile(join(NOTIFICATION_MIGRATIONS_DIR, file), "utf-8");
    const statements = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pool.query(statement);
    }
  }

  await pool.query(`DROP TABLE IF EXISTS \`${DRIZZLE_MIGRATIONS_TABLE}\``);
}
