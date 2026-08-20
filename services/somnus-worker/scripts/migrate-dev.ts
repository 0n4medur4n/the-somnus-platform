/**
 * Applies the worker's migrations to a local/CI MySQL, standalone (build plan §5.7
 * / ADR 0010: two independent logical databases + migration histories — one per
 * isolated module). Run from source via @swc-node/register so the migrate helpers
 * resolve their .sql folders (not copied to dist). DB URLs come from the
 * environment; defaults target docker/CI MySQL.
 */

import { createAuditDb, createAuditPool } from "../src/modules/audit/db/audit-db.client.js";
import { loadAuditDbConfig } from "../src/modules/audit/db/audit-db.config.js";
import { runAuditMigrationsUp } from "../src/modules/audit/db/migrate.js";
import { runNotificationMigrationsUp } from "../src/modules/notification/db/migrate.js";
import {
  createNotificationDb,
  createNotificationPool,
} from "../src/modules/notification/db/notification-db.client.js";
import { loadNotificationDbConfig } from "../src/modules/notification/db/notification-db.config.js";

const notificationPool = createNotificationPool(loadNotificationDbConfig(process.env));
await runNotificationMigrationsUp(createNotificationDb(notificationPool));
await notificationPool.end();
console.warn("[migrate] somnus_notifications migrated");

const auditPool = createAuditPool(loadAuditDbConfig(process.env));
await runAuditMigrationsUp(createAuditDb(auditPool));
await auditPool.end();
console.warn("[migrate] somnus_audit migrated");
