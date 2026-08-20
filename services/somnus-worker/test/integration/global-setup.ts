import { runNotificationMigrationsUp } from "../../src/modules/notification/db/migrate.js";
import {
  createNotificationDb,
  createNotificationPool,
} from "../../src/modules/notification/db/notification-db.client.js";
import { loadNotificationDbConfig } from "../../src/modules/notification/db/notification-db.config.js";

/**
 * Migrates `somnus_notifications` to head before the integration suite runs
 * (build plan §19: integration tests against a real MySQL). Locally that's
 * docker-compose; in CI it's the MySQL service in the worker-service job.
 */
export async function setup(): Promise<void> {
  const pool = createNotificationPool(loadNotificationDbConfig(process.env));
  await runNotificationMigrationsUp(createNotificationDb(pool));
  await pool.end();
}
