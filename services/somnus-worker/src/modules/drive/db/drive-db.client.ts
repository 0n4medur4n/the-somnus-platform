import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { DriveDbConfig } from "./drive-db.config.js";
import * as schema from "./schema/index.js";

export type DriveDb = MySql2Database<typeof schema>;

/** Lazy pool: mysql2 opens no connection until the first query (build plan §2). */
export function createDrivePool(config: DriveDbConfig): Pool {
  return mysql.createPool({
    uri: config.DRIVE_DATABASE_URL,
    connectionLimit: config.DRIVE_DB_POOL_SIZE,
    ...(config.DRIVE_DB_SSL ? { ssl: { minVersion: "TLSv1.2" as const } } : {}),
  });
}

export function createDriveDb(pool: Pool): DriveDb {
  return drizzle(pool, { schema, mode: "default" });
}
