import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { AuditModule } from "../src/modules/audit/audit.module.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { AuditDbModule } from "../src/modules/audit/db/audit-db.module.js";
import { NotificationDbModule } from "../src/modules/notification/db/notification-db.module.js";
import { NotificationModule } from "../src/modules/notification/notification.module.js";
import { NotificationService } from "../src/modules/notification/notification.service.js";

/**
 * The isolated modules expose ONLY their public service; their databases and
 * repositories are module-private (build plan §5.7 / ADR 0010). Proven
 * structurally from the module metadata: each module's `exports` is exactly its
 * service (never the repository / DB symbol), and the DB modules are not `@Global`
 * — so the repository never reaches the root or the other isolated module.
 */
function exportsOf(module: object): unknown[] {
  return (Reflect.getMetadata("exports", module) as unknown[] | undefined) ?? [];
}

function isGlobal(module: object): boolean {
  return Boolean(Reflect.getMetadata("__module:global__", module));
}

describe("isolated-module boundaries", () => {
  it("each module exports ONLY its public service", () => {
    expect(exportsOf(NotificationModule)).toEqual([NotificationService]);
    expect(exportsOf(AuditModule)).toEqual([AuditService]);
  });

  it("the module databases are not global — no cross-module DB access", () => {
    expect(isGlobal(NotificationDbModule)).toBe(false);
    expect(isGlobal(AuditDbModule)).toBe(false);
  });
});
