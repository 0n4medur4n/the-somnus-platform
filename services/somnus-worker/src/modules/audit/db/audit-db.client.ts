import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { AuditDbConfig } from "./audit-db.config.js";
import * as schema from "./schema/index.js";

export type AuditDb = MySql2Database<typeof schema>;

/** Lazy pool: mysql2 opens no connection until the first query (build plan §2). */
export function createAuditPool(config: AuditDbConfig): Pool {
  return mysql.createPool({
    uri: config.AUDIT_DATABASE_URL,
    connectionLimit: config.AUDIT_DB_POOL_SIZE,
    ...(config.AUDIT_DB_SSL ? { ssl: { minVersion: "TLSv1.2" as const } } : {}),
  });
}

export function createAuditDb(pool: Pool): AuditDb {
  return drizzle(pool, { schema, mode: "default" });
}
