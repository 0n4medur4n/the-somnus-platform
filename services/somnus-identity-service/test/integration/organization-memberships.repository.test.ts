import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { OrganizationMembershipsRepository } from "../../src/infrastructure/db/repositories/organization-memberships.repository.js";
import { OrganizationsRepository } from "../../src/infrastructure/db/repositories/organizations.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("OrganizationMembershipsRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const orgs = new OrganizationsRepository(db);
  const repo = new OrganizationMembershipsRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  it("build plan §8 canonical case: findMembership requires both organizationId and membershipId", async () => {
    const orgId = await orgs.create({ name: "Org" });
    const userId = await users.create({ email: "member@example.com" });
    const membershipId = await repo.create({ organizationId: orgId, userId });

    const found = await repo.findMembership({ organizationId: orgId, membershipId });
    expect(found?.userId).toBe(userId);
  });

  it("a membership from org A is not found when scoped to org B", async () => {
    const orgA = await orgs.create({ name: "Org A" });
    const orgB = await orgs.create({ name: "Org B" });
    const userId = await users.create({ email: "cross-org@example.com" });
    const membershipId = await repo.create({ organizationId: orgA, userId });

    expect(await repo.findMembership({ organizationId: orgB, membershipId })).toBeNull();
  });

  it("findByOrgAndUser and listMembers are scoped to the organization", async () => {
    const orgA = await orgs.create({ name: "Org A" });
    const orgB = await orgs.create({ name: "Org B" });
    const userId = await users.create({ email: "shared@example.com" });
    await repo.create({ organizationId: orgA, userId });

    expect(await repo.findByOrgAndUser({ organizationId: orgA, userId })).not.toBeNull();
    expect(await repo.findByOrgAndUser({ organizationId: orgB, userId })).toBeNull();
    expect(await repo.listMembers({ organizationId: orgA })).toHaveLength(1);
    expect(await repo.listMembers({ organizationId: orgB })).toHaveLength(0);
  });

  it("setStatus only affects the membership within the given organization scope", async () => {
    const orgId = await orgs.create({ name: "Org" });
    const userId = await users.create({ email: "status@example.com" });
    const membershipId = await repo.create({ organizationId: orgId, userId });

    await repo.setStatus({ organizationId: orgId, membershipId }, "inactive");

    const found = await repo.findMembership({ organizationId: orgId, membershipId });
    expect(found?.status).toBe("inactive");
  });

  it("setStatus is a no-op when the membership does not belong to the given organization", async () => {
    const orgA = await orgs.create({ name: "Org A" });
    const orgB = await orgs.create({ name: "Org B" });
    const userId = await users.create({ email: "noop@example.com" });
    const membershipId = await repo.create({ organizationId: orgA, userId });

    await repo.setStatus({ organizationId: orgB, membershipId }, "removed");

    const found = await repo.findMembership({ organizationId: orgA, membershipId });
    expect(found?.status).toBe("active");
  });

  it("findMembership returns null for a random membership id", async () => {
    const orgId = await orgs.create({ name: "Org" });
    expect(await repo.findMembership({ organizationId: orgId, membershipId: UUIDv7() })).toBeNull();
  });
});
