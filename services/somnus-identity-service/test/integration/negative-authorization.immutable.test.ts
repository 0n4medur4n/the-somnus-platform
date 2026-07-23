/**
 * IMMUTABLE -- build plan §20 Checkpoint 6.3 ("Negative authorization
 * suite"). These ten scenarios are the platform's authorization safety
 * net, named explicitly in the build plan:
 *
 *   1. org admin cannot read clinical data automatically
 *   2. inactive professional denied
 *   3. unverified professional denied where verification required
 *   4. expired membership denied
 *   5. revoked grant denied
 *   6. cross-organization member access denied
 *   7. self-assignment of privileged roles denied
 *   8. support staff denied health data by default
 *   9. invitation token single-use
 *  10. deleted/suspended user cannot create a session
 *
 * DO NOT weaken, skip, or delete a test in this file to make a change
 * elsewhere pass. If a source change makes one of these ten fail, the
 * source change is wrong, not the test. If build plan §11 itself
 * changes, that is a build-plan amendment, and this file's rewrite
 * belongs in the same PR as that amendment, reviewed as a
 * security-relevant change -- not a routine test update. CI must run
 * this file on every PR (see .github/workflows/ci.yml and the
 * "Negative authorization suite" section of this service's README).
 *
 * This file intentionally does not import helpers from other test
 * files: an immutable suite should not silently change behavior
 * because an unrelated test file's shared helper was edited.
 *
 * Item 10 (deleted/suspended user cannot create a session) is tested
 * at the authorization layer, not via a real session-creation
 * endpoint: `sessions` endpoints are stubs until Phase 8 (build plan
 * §20 Checkpoint 6.2). `DENIED_ACTOR_ACCOUNT_INACTIVE` is the gate a
 * real session-creation flow will depend on once it exists -- this is
 * the honest, currently-testable proxy for that requirement, not a
 * skip.
 */
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { INTERNAL_ROLE_KEYS, type RoleKey } from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/common/decorators/current-actor.decorator.js";
import { OrganizationMembershipsRepository } from "../../src/infrastructure/db/repositories/organization-memberships.repository.js";
import { ProfessionalProfilesRepository } from "../../src/infrastructure/db/repositories/professional-profiles.repository.js";
import { RoleAssignmentsRepository } from "../../src/infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../src/infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

type JsonResponse = { statusCode: number; body: unknown };

async function inject(
  server: FastifyInstance,
  method: string,
  url: string,
  options: { actorId?: string; payload?: unknown } = {},
): Promise<JsonResponse> {
  const res = await server.inject({
    method,
    url,
    headers: {
      ...(options.actorId ? { [ACTOR_ID_HEADER]: options.actorId } : {}),
      ...(options.payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: options.payload !== undefined ? JSON.stringify(options.payload) : undefined,
  });
  const body = res.body.length > 0 ? res.json() : undefined;
  return { statusCode: res.statusCode, body };
}

describe("negative authorization suite (IMMUTABLE -- build plan §20 Checkpoint 6.3)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  const users = new UsersRepository(getTestDb());
  const professionalProfiles = new ProfessionalProfilesRepository(getTestDb());
  const roles = new RolesRepository(getTestDb());
  const roleAssignments = new RoleAssignmentsRepository(getTestDb());
  const memberships = new OrganizationMembershipsRepository(getTestDb());

  /** Migration 0001 permanently seeds all 11 build plan §11 roles; resetTables() never wipes `roles` (see db-test-helper.ts). */
  async function assignRole(userId: string, key: RoleKey, organizationId?: string): Promise<void> {
    const role = await roles.findByKey(key);
    if (!role) {
      throw new Error(`role "${key}" was not found -- has migration 0001 been applied?`);
    }
    await roleAssignments.assign({
      userId,
      roleId: role.id,
      ...(organizationId ? { organizationId } : {}),
      assignedBy: userId,
    });
  }

  async function makeVerifiedProfessional(email: string): Promise<string> {
    const userId = await users.create({ email });
    await professionalProfiles.create({
      userId,
      specialty: "psychologist",
      licenseNumber: "LIC-1",
    });
    await professionalProfiles.setVerificationStatus({ userId }, "verified");
    await assignRole(userId, "professional");
    return userId;
  }

  async function createOrganization(ownerActorId: string, name: string): Promise<string> {
    const res = await inject(server, "POST", "/v1/organizations", {
      actorId: ownerActorId,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return (res.body as { id: string }).id;
  }

  async function checkAuthorization(payload: {
    actorUserId: string;
    subjectUserId: string;
    action: "read_clinical_data" | "read_administrative_data" | "manage_organization";
    organizationId?: string;
  }): Promise<{ allowed: boolean; reasonCode: string }> {
    const res = await inject(server, "POST", "/internal/v1/authorization/check", { payload });
    expect(res.statusCode).toBe(200);
    return res.body as { allowed: boolean; reasonCode: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it("1. org admin cannot read clinical data automatically", async () => {
    const owner = await users.create({ email: "owner1@example.com" });
    const organizationId = await createOrganization(owner, "Acme Health");
    const subject = await users.create({ email: "subject1@example.com" });

    const decision = await checkAuthorization({
      actorUserId: owner,
      subjectUserId: subject,
      action: "read_clinical_data",
      organizationId,
    });

    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: "DENIED_ADMINISTRATIVE_ROLE_NOT_CLINICAL",
    });
  });

  it("2. inactive professional denied", async () => {
    const professional = await makeVerifiedProfessional("pro2@example.com");
    await users.setStatus(professional, "suspended");
    const subject = await users.create({ email: "subject2@example.com" });

    const decision = await checkAuthorization({
      actorUserId: professional,
      subjectUserId: subject,
      action: "read_clinical_data",
    });

    expect(decision).toMatchObject({ allowed: false, reasonCode: "DENIED_ACTOR_ACCOUNT_INACTIVE" });
  });

  it("3. unverified professional denied where verification required", async () => {
    const professional = await users.create({ email: "pro3@example.com" });
    await professionalProfiles.create({
      userId: professional,
      specialty: "psychologist",
      licenseNumber: "LIC-3",
    });
    // verificationStatus defaults to "pending" -- never verified.
    await assignRole(professional, "professional");
    const subject = await users.create({ email: "subject3@example.com" });

    const decision = await checkAuthorization({
      actorUserId: professional,
      subjectUserId: subject,
      action: "read_clinical_data",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: "DENIED_PROFESSIONAL_NOT_VERIFIED",
    });
  });

  it("4. expired (inactive) membership denied", async () => {
    // The current identity schema models membership lapsing as a
    // status transition (active -> inactive), not a time-based
    // expiresAt field -- this is that mechanism's negative path.
    const owner = await users.create({ email: "owner4@example.com" });
    const organizationId = await createOrganization(owner, "Acme Health 4");
    const professional = await makeVerifiedProfessional("pro4@example.com");

    const inviteRes = await inject(
      server,
      "POST",
      `/v1/organizations/${organizationId}/invitations`,
      {
        actorId: owner,
        payload: { email: "pro4@example.com" },
      },
    );
    expect(inviteRes.statusCode).toBe(201);
    const { token } = inviteRes.body as { token: string };

    const acceptRes = await inject(server, "POST", "/v1/invitations/accept", {
      actorId: professional,
      payload: { token },
    });
    expect(acceptRes.statusCode).toBe(201);

    const membersRes = await inject(server, "GET", `/v1/organizations/${organizationId}/members`, {
      actorId: owner,
    });
    const membership = (membersRes.body as Array<{ id: string; userId: string }>).find(
      (m) => m.userId === professional,
    );
    if (!membership) throw new Error("professional membership not found after accept");

    await memberships.setStatus({ organizationId, membershipId: membership.id }, "inactive");

    const decision = await checkAuthorization({
      actorUserId: professional,
      subjectUserId: await users.create({ email: "subject4@example.com" }),
      action: "read_clinical_data",
      organizationId,
    });

    expect(decision).toMatchObject({ allowed: false, reasonCode: "DENIED_NO_ACTIVE_MEMBERSHIP" });
  });

  it("5. revoked grant denied", async () => {
    const subject = await users.create({ email: "subject5@example.com" });
    const professional = await makeVerifiedProfessional("pro5@example.com");

    const createRes = await inject(server, "POST", "/v1/me/access-grants", {
      actorId: subject,
      payload: { professionalUserId: professional, scope: "clinical_data:read" },
    });
    expect(createRes.statusCode).toBe(201);
    const grantId = (createRes.body as { id: string }).id;

    const revokeRes = await inject(server, "POST", `/v1/me/access-grants/${grantId}/revoke`, {
      actorId: subject,
    });
    expect(revokeRes.statusCode).toBe(204);

    const decision = await checkAuthorization({
      actorUserId: professional,
      subjectUserId: subject,
      action: "read_clinical_data",
    });

    expect(decision).toMatchObject({ allowed: false, reasonCode: "DENIED_ACCESS_GRANT_REVOKED" });
  });

  it("6. cross-organization member access denied", async () => {
    const ownerA = await users.create({ email: "ownerA6@example.com" });
    const organizationAId = await createOrganization(ownerA, "Org A");
    const ownerB = await users.create({ email: "ownerB6@example.com" });
    await createOrganization(ownerB, "Org B");

    // ownerB is only ever a member of Org B; probing Org A must be denied.
    const decision = await checkAuthorization({
      actorUserId: ownerB,
      subjectUserId: ownerB,
      action: "read_administrative_data",
      organizationId: organizationAId,
    });

    expect(decision).toMatchObject({ allowed: false, reasonCode: "DENIED_CROSS_ORGANIZATION" });
  });

  it.each([...INTERNAL_ROLE_KEYS] as const)(
    "7. self-assignment of privileged roles denied (%s via invitation)",
    async (internalRoleKey) => {
      const owner = await users.create({ email: "owner7@example.com" });
      const organizationId = await createOrganization(owner, "Acme Health 7");

      const res = await inject(server, "POST", `/v1/organizations/${organizationId}/invitations`, {
        actorId: owner,
        payload: { email: "owner7@example.com", roleKey: internalRoleKey },
      });

      expect(res.statusCode).toBe(403);
    },
  );

  it("8. support staff denied health data by default", async () => {
    const supportAgent = await users.create({ email: "support8@example.com" });
    await assignRole(supportAgent, "support_agent");
    const subject = await users.create({ email: "subject8@example.com" });

    const decision = await checkAuthorization({
      actorUserId: supportAgent,
      subjectUserId: subject,
      action: "read_clinical_data",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: "DENIED_SUPPORT_ROLE_HEALTH_DATA_RESTRICTED",
    });
  });

  it("9. invitation token single-use", async () => {
    const owner = await users.create({ email: "owner9@example.com" });
    const organizationId = await createOrganization(owner, "Acme Health 9");
    const invitee = await users.create({ email: "invitee9@example.com" });

    const inviteRes = await inject(
      server,
      "POST",
      `/v1/organizations/${organizationId}/invitations`,
      {
        actorId: owner,
        payload: { email: "invitee9@example.com" },
      },
    );
    const { token } = inviteRes.body as { token: string };

    const firstAccept = await inject(server, "POST", "/v1/invitations/accept", {
      actorId: invitee,
      payload: { token },
    });
    expect(firstAccept.statusCode).toBe(201);

    const replayAccept = await inject(server, "POST", "/v1/invitations/accept", {
      actorId: invitee,
      payload: { token },
    });
    expect(replayAccept.statusCode).toBe(409);
  });

  it.each(["suspended", "deleted"] as const)(
    "10. %s user cannot create a session (authorization-layer proxy -- sessions are stubbed until Phase 8)",
    async (status) => {
      const user = await users.create({ email: `user10-${status}@example.com` });
      await users.setStatus(user, status);

      const decision = await checkAuthorization({
        actorUserId: user,
        subjectUserId: user,
        action: "read_clinical_data",
      });

      expect(decision).toMatchObject({
        allowed: false,
        reasonCode: "DENIED_ACTOR_ACCOUNT_INACTIVE",
      });
    },
  );
});
