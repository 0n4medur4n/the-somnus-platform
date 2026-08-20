/**
 * Applies the notification migrations to a local/CI MySQL, standalone (build plan
 * §5.7 / ADR 0010: an independent logical database + migration history). Run from
 * source via @swc-node/register so the migrate helper resolves its .sql folder
 * (not copied to dist). The DB URL comes from the environment; the default
 * targets docker/CI MySQL.
 */

import { runNotificationMigrationsUp } from "../src/modules/notification/db/migrate.js";
import {
  createNotificationDb,
  createNotificationPool,
} from "../src/modules/notification/db/notification-db.client.js";
import { loadNotificationDbConfig } from "../src/modules/notification/db/notification-db.config.js";

const pool = createNotificationPool(loadNotificationDbConfig(process.env));
await runNotificationMigrationsUp(createNotificationDb(pool));
await pool.end();
console.warn("[migrate] somnus_notifications migrated");
