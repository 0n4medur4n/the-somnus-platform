import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { ConsentDbConfig } from "./consent-db.config.js";
import * as schema from "./schema/index.js";

export type ConsentDb = MySql2Database<typeof schema>;

/** Lazy pool, same rationale as identity's db.client.ts: no eager warm-up (build plan §2). */
export function createConsentPool(config: ConsentDbConfig): Pool {
  return mysql.createPool({
    uri: config.CONSENT_DATABASE_URL,
    connectionLimit: config.CONSENT_DB_POOL_SIZE,
    ...(config.CONSENT_DB_SSL ? { ssl: { minVersion: "TLSv1.2" as const } } : {}),
  });
}

export function createConsentDb(pool: Pool): ConsentDb {
  return drizzle(pool, { schema, mode: "default" });
}
