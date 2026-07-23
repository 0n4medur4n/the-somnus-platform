import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import type { DbConfig } from "./db.config.js";
import * as schema from "./schema/index.js";

export type Db = MySql2Database<typeof schema>;

/**
 * Lazy pool: mysql2 does not eagerly open connections on creation, only
 * on first query, up to `connectionLimit` (build plan §2: no eager
 * pool warm-up).
 */
export function createPool(config: DbConfig): Pool {
  return mysql.createPool({
    uri: config.DATABASE_URL,
    connectionLimit: config.DB_POOL_SIZE,
    // TiDB Cloud's public endpoint requires TLS; local docker-compose
    // MySQL does not speak TLS at all, hence this is opt-in (DB_SSL=true)
    // rather than inferred from the host. `{}` trusts Node's default CA
    // bundle, which covers TiDB Cloud's publicly-issued certificate.
    ...(config.DB_SSL ? { ssl: { minVersion: "TLSv1.2" as const } } : {}),
  });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema, mode: "default" });
}
