import { createDb, createPool, type Db } from "../../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../../src/infrastructure/db/db.config.js";
import * as schema from "../../src/infrastructure/db/schema/index.js";

let pool: ReturnType<typeof createPool> | undefined;
let db: Db | undefined;

/** One pool per test process (build plan §2: no eager warm-up beyond what's needed). */
export function getTestDb(): Db {
  if (!db) {
    const config = loadDbConfig(process.env);
    pool = createPool(config);
    db = createDb(pool);
  }
  return db;
}

const TABLES_IN_DELETE_ORDER = [
  schema.identityAuditEvents,
  schema.deletionRequests,
  schema.sessionRevocations,
  schema.accountStatusHistory,
  schema.accessGrants,
  schema.roleAssignments,
  schema.rolePermissions,
  schema.permissions,
  // schema.roles is deliberately NOT reset: migration
  // 0001_seed_platform_roles.sql seeds the fixed build plan §11 catalog
  // once, the same way it would in any real environment. Wiping it
  // between tests would make every test that assigns or checks a role
  // (which is most of them) responsible for re-seeding reference data
  // that isn't theirs to manage.
  schema.organizationInvitations,
  schema.organizationMemberships,
  schema.organizationLocations,
  schema.organizations,
  schema.professionalVerificationCases,
  schema.professionalCredentials,
  schema.professionalProfiles,
  schema.individualProfiles,
  schema.userIdentities,
  schema.users,
];

/** Clears every table between tests (except `roles`, see above). Safe because there are no FK constraints (schema/index.ts). */
export async function resetTables(): Promise<void> {
  const database = getTestDb();
  for (const table of TABLES_IN_DELETE_ORDER) {
    await database.delete(table);
  }
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
