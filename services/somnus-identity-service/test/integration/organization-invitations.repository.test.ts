import { beforeEach, describe, expect, it } from "vitest";
import { OrganizationInvitationsRepository } from "../../src/infrastructure/db/repositories/organization-invitations.repository.js";
import { OrganizationsRepository } from "../../src/infrastructure/db/repositories/organizations.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("OrganizationInvitationsRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const orgs = new OrganizationsRepository(db);
  const repo = new OrganizationInvitationsRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  async function inviteFixture() {
    const orgId = await orgs.create({ name: "Org" });
    const inviter = await users.create({ email: "inviter@example.com" });
    const { id, token } = await repo.create({
      organizationId: orgId,
      email: "invitee@example.com",
      invitedBy: inviter,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });
    return { orgId, inviter, id, token };
  }

  it("creates an invitation with a unique single-use token", async () => {
    const { orgId, id, token } = await inviteFixture();
    const found = await repo.findByOrgAndId({ organizationId: orgId, invitationId: id });
    expect(found?.status).toBe("pending");
    expect(token).toHaveLength(43); // 32 random bytes, base64url
  });

  it("accept() consumes the token exactly once (build plan §20 Checkpoint 6.3)", async () => {
    const { token } = await inviteFixture();

    expect(await repo.accept(token)).toBe(true);
    // Second call: status is no longer "pending", so it is a no-op.
    expect(await repo.accept(token)).toBe(false);

    const found = await repo.findByToken(token);
    expect(found?.status).toBe("accepted");
  });

  it("findByOrgAndId returns null when the invitation belongs to a different organization", async () => {
    const { id } = await inviteFixture();
    const otherOrg = await orgs.create({ name: "Other Org" });
    expect(await repo.findByOrgAndId({ organizationId: otherOrg, invitationId: id })).toBeNull();
  });

  it("listPending only returns pending invitations for the scoped organization", async () => {
    const { orgId } = await inviteFixture();
    const otherOrg = await orgs.create({ name: "Other" });

    expect(await repo.listPending({ organizationId: orgId })).toHaveLength(1);
    expect(await repo.listPending({ organizationId: otherOrg })).toHaveLength(0);
  });
});
