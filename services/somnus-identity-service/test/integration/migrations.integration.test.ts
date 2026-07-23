import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, createPool, type Db } from "../../src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../../src/infrastructure/db/db.config.js";
import { runMigrationsDown, runMigrationsUp } from "../../src/infrastructure/db/migrate.js";
import { roles } from "../../src/infrastructure/db/schema/index.js";

const EXPECTED_TABLES = [
  "users",
  "user_identities",
  "individual_profiles",
  "professional_profiles",
  "professional_credentials",
  "professional_verification_cases",
  "organizations",
  "organization_locations",
  "organization_memberships",
  "organization_invitations",
  "roles",
  "permissions",
  "role_permissions",
  "role_assignments",
  "access_grants",
  "account_status_history",
  "session_revocations",
  "deletion_requests",
  "identity_audit_events",
];

async function listTables(db: Db): Promise<string[]> {
  const rows = (await db.execute(sql`SHOW TABLES`)) as unknown as [Record<string, string>[]];
  return rows[0].map((row) => Object.values(row)[0] as string);
}

describe("migration up/down (build plan §8 rollback policy, Checkpoint 6.1)", () => {
  const config = loadDbConfig(process.env);
  const pool = createPool(config);
  const db = createDb(pool);

  afterAll(async () => {
    // Leave the database migrated for the rest of the suite regardless
    // of pass/fail (globalSetup already applied it once; this repeats
    // "up" defensively in case a failure happened mid-cycle below).
    await runMigrationsUp(db);
    await pool.end();
  });

  it("up creates every §12 table and seeds the build plan §11 role catalog", async () => {
    await runMigrationsUp(db);
    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
    const seededRoles = await db.select().from(roles);
    expect(seededRoles).toHaveLength(11);
  });

  it("down removes every §12 table", async () => {
    await runMigrationsDown(pool);
    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables, `table ${table} still present after down`).not.toContain(table);
    }
  });

  it("up is re-appliable after down (idempotent recovery path)", async () => {
    await runMigrationsUp(db);
    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables, `missing table ${table} after re-up`).toContain(table);
    }
  });
});
