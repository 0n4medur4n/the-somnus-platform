import { beforeEach, describe, expect, it } from "vitest";
import { OrganizationsRepository } from "../../src/infrastructure/db/repositories/organizations.repository.js";
import { RoleAssignmentsRepository } from "../../src/infrastructure/db/repositories/role-assignments.repository.js";
import {
  type RoleKey,
  RolesRepository,
} from "../../src/infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("RoleAssignmentsRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const orgs = new OrganizationsRepository(db);
  const roles = new RolesRepository(db);
  const repo = new RoleAssignmentsRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  /** Roles are seeded once by migration 0001_seed_platform_roles.sql (build plan §11), never re-created here. */
  async function seededRoleId(key: RoleKey): Promise<string> {
    const role = await roles.findByKey(key);
    if (!role) throw new Error(`expected role "${key}" to be seeded by migration 0001`);
    return role.id;
  }

  it("assigns a role to a user and lists it in that user's active assignments", async () => {
    const userId = await users.create({ email: "assignee@example.com" });
    const assigner = await users.create({ email: "assigner@example.com" });
    const roleId = await seededRoleId("individual_user");

    await repo.assign({ userId, roleId, assignedBy: assigner });

    const active = await repo.listActiveForUser({ userId });
    expect(active).toHaveLength(1);
    expect(active[0]?.roleId).toBe(roleId);
  });

  it("a different user's scope sees no assignments (build plan §8)", async () => {
    const userA = await users.create({ email: "a@example.com" });
    const userB = await users.create({ email: "b@example.com" });
    const assigner = await users.create({ email: "assigner2@example.com" });
    const roleId = await seededRoleId("professional");
    await repo.assign({ userId: userA, roleId, assignedBy: assigner });

    expect(await repo.listActiveForUser({ userId: userB })).toHaveLength(0);
  });

  it("scopes by organization too for organization-scoped roles", async () => {
    const userId = await users.create({ email: "org-scoped@example.com" });
    const assigner = await users.create({ email: "assigner3@example.com" });
    const orgA = await orgs.create({ name: "Org A" });
    const orgB = await orgs.create({ name: "Org B" });
    const roleId = await seededRoleId("organization_admin");
    await repo.assign({ userId, roleId, organizationId: orgA, assignedBy: assigner });

    expect(
      await repo.listActiveForUserInOrganization({ userId, organizationId: orgA }),
    ).toHaveLength(1);
    expect(
      await repo.listActiveForUserInOrganization({ userId, organizationId: orgB }),
    ).toHaveLength(0);
  });

  it("revoke excludes the assignment from the active list", async () => {
    const userId = await users.create({ email: "revoke@example.com" });
    const assigner = await users.create({ email: "assigner4@example.com" });
    const roleId = await seededRoleId("clinical_supervisor");
    const assignmentId = await repo.assign({ userId, roleId, assignedBy: assigner });

    await repo.revoke({ userId, assignmentId });

    expect(await repo.listActiveForUser({ userId })).toHaveLength(0);
  });
});
