import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { NotificationDbConfig } from "./notification-db.config.js";
import * as schema from "./schema/index.js";

export type NotificationDb = MySql2Database<typeof schema>;

/** Lazy pool: mysql2 opens no connection until the first query (build plan §2). */
export function createNotificationPool(config: NotificationDbConfig): Pool {
  return mysql.createPool({
    uri: config.NOTIFICATIONS_DATABASE_URL,
    connectionLimit: config.NOTIFICATIONS_DB_POOL_SIZE,
    ...(config.NOTIFICATIONS_DB_SSL ? { ssl: { minVersion: "TLSv1.2" as const } } : {}),
  });
}

export function createNotificationDb(pool: Pool): NotificationDb {
  return drizzle(pool, { schema, mode: "default" });
}
