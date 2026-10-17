import { createAuditDb, createAuditPool } from "../../src/modules/audit/db/audit-db.client.js";
import { loadAuditDbConfig } from "../../src/modules/audit/db/audit-db.config.js";
import { runAuditMigrationsUp } from "../../src/modules/audit/db/migrate.js";
import { runNotificationMigrationsUp } from "../../src/modules/notification/db/migrate.js";
import {
  createNotificationDb,
  createNotificationPool,
} from "../../src/modules/notification/db/notification-db.client.js";
import { loadNotificationDbConfig } from "../../src/modules/notification/db/notification-db.config.js";

/**
 * Migrates both isolated-module databases (`somnus_notifications`, `somnus_audit`)
 * to head before the integration suite runs (build plan §19: real MySQL). Locally
 * that's docker-compose; in CI it's the MySQL service in the worker-service job.
 */
export async function setup(): Promise<void> {
  const notificationPool = createNotificationPool(loadNotificationDbConfig(process.env));
  await runNotificationMigrationsUp(createNotificationDb(notificationPool));
  await notificationPool.end();

  const auditPool = createAuditPool(loadAuditDbConfig(process.env));
  await runAuditMigrationsUp(createAuditDb(auditPool));
  await auditPool.end();
}
