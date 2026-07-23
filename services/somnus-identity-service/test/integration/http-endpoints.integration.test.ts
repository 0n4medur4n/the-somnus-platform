import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/common/decorators/current-actor.decorator.js";
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
  // 204 (and any other empty body) has nothing for res.json() to parse.
  const body = res.body.length > 0 ? res.json() : undefined;
  return { statusCode: res.statusCode, body };
}

describe("identity-service HTTP endpoints (build plan §20 Checkpoint 6.2)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const users = new UsersRepository(getTestDb());
  const professionalProfiles = new ProfessionalProfilesRepository(getTestDb());
  const roles = new RolesRepository(getTestDb());
  const roleAssignments = new RoleAssignmentsRepository(getTestDb());

  /** No seed data exists yet (scripts/seed-dev.ts lands in a later checkpoint) -- seed the one role this test needs directly. */
  async function makeVerifiedProfessional(email: string): Promise<string> {
    const userId = await users.create({ email });
    await professionalProfiles.create({
      userId,
      specialty: "psychologist",
      licenseNumber: "LIC-1",
    });
    await professionalProfiles.setVerificationStatus({ userId }, "verified");

    let role = await roles.findByKey("professional");
    if (!role) {
      await roles.seedRole({
        key: "professional",
        name: "Professional",
        scope: "platform",
        isInternal: false,
      });
      role = await roles.findByKey("professional");
    }
    if (!role) throw new Error("failed to seed professional role");
    await roleAssignments.assign({ userId, roleId: role.id, assignedBy: userId });

    return userId;
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

  describe("GET /v1/me", () => {
    it("401s without an actor header", async () => {
      const res = await inject(server, "GET", "/v1/me");
      expect(res.statusCode).toBe(401);
    });

    it("returns the user with null profiles when none exist yet", async () => {
      const userId = await users.create({ email: "me@example.com" });
      const res = await inject(server, "GET", "/v1/me", { actorId: userId });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        user: { id: userId, email: "me@example.com" },
        individualProfile: null,
        professionalProfile: null,
      });
    });

    it("404s when the actor header names a user that does not exist", async () => {
      const res = await inject(server, "GET", "/v1/me", {
        actorId: "00000000-0000-7000-8000-000000000000",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("organizations + members + invitations lifecycle", () => {
    it("create -> get -> patch (owner) -> patch denied for a non-member -> invite -> accept -> list members -> patch a member's status", async () => {
      const owner = await users.create({ email: "owner@example.com" });
      const outsider = await users.create({ email: "outsider@example.com" });
      const invitee = await users.create({ email: "invitee@example.com" });

      const createRes = await inject(server, "POST", "/v1/organizations", {
        actorId: owner,
        payload: { name: "Acme Health" },
      });
      expect(createRes.statusCode).toBe(201);
      const organizationId = (createRes.body as { id: string }).id;

      const getRes = await inject(server, "GET", `/v1/organizations/${organizationId}`, {
        actorId: owner,
      });
      expect(getRes.statusCode).toBe(200);
      expect((getRes.body as { name: string }).name).toBe("Acme Health");

      const patchRes = await inject(server, "PATCH", `/v1/organizations/${organizationId}`, {
        actorId: owner,
        payload: { name: "Acme Health Renamed" },
      });
      expect(patchRes.statusCode).toBe(200);
      expect((patchRes.body as { name: string }).name).toBe("Acme Health Renamed");

      const deniedRes = await inject(server, "PATCH", `/v1/organizations/${organizationId}`, {
        actorId: outsider,
        payload: { name: "Hijacked" },
      });
      expect(deniedRes.statusCode).toBe(403);

      const inviteRes = await inject(
        server,
        "POST",
        `/v1/organizations/${organizationId}/invitations`,
        {
          actorId: owner,
          payload: { email: "invitee@example.com" },
        },
      );
      expect(inviteRes.statusCode).toBe(201);
      const { token } = inviteRes.body as { token: string };
      expect(token).toBeTruthy();

      const acceptRes = await inject(server, "POST", "/v1/invitations/accept", {
        actorId: invitee,
        payload: { token },
      });
      expect(acceptRes.statusCode).toBe(201);
      expect((acceptRes.body as { status: string }).status).toBe("accepted");

      // Single-use: replaying the same token must not succeed again.
      const replayRes = await inject(server, "POST", "/v1/invitations/accept", {
        actorId: invitee,
        payload: { token },
      });
      expect(replayRes.statusCode).toBe(409);

      const membersRes = await inject(
        server,
        "GET",
        `/v1/organizations/${organizationId}/members`,
        {
          actorId: owner,
        },
      );
      expect(membersRes.statusCode).toBe(200);
      const members = membersRes.body as Array<{ id: string; userId: string }>;
      expect(members).toHaveLength(2);
      const inviteeMembership = members.find((m) => m.userId === invitee);
      expect(inviteeMembership).toBeDefined();

      const patchMemberRes = await inject(
        server,
        "PATCH",
        `/v1/organizations/${organizationId}/members/${inviteeMembership?.id}`,
        { actorId: owner, payload: { status: "inactive" } },
      );
      expect(patchMemberRes.statusCode).toBe(200);
      expect((patchMemberRes.body as { status: string }).status).toBe("inactive");

      // A non-member cannot list the roster either.
      const deniedListRes = await inject(
        server,
        "GET",
        `/v1/organizations/${organizationId}/members`,
        {
          actorId: outsider,
        },
      );
      expect(deniedListRes.statusCode).toBe(403);
    });
  });

  describe("POST /internal/v1/authorization/check", () => {
    it("denies clinical access with no grant and returns DENIED_ACCESS_GRANT_NOT_FOUND", async () => {
      const professional = await makeVerifiedProfessional("pro@example.com");
      const subject = await users.create({ email: "subject@example.com" });

      const res = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: {
          actorUserId: professional,
          subjectUserId: subject,
          action: "read_clinical_data",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        allowed: false,
        reasonCode: "DENIED_ACCESS_GRANT_NOT_FOUND",
      });
    });

    it("allows self access unconditionally", async () => {
      const userId = await users.create({ email: "self@example.com" });
      const res = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: { actorUserId: userId, subjectUserId: userId, action: "read_clinical_data" },
      });
      expect(res.body).toMatchObject({ allowed: true, reasonCode: "AUTHORIZED_SELF_ACCESS" });
    });
  });

  describe("access grants (self-service)", () => {
    it("creates a grant, lists it, then revoking removes it from the active list", async () => {
      const subject = await users.create({ email: "grantor@example.com" });
      const professional = await users.create({ email: "grantee@example.com" });

      const createRes = await inject(server, "POST", "/v1/me/access-grants", {
        actorId: subject,
        payload: { professionalUserId: professional, scope: "clinical_data:read" },
      });
      expect(createRes.statusCode).toBe(201);
      const grantId = (createRes.body as { id: string }).id;

      const listRes = await inject(server, "GET", "/v1/me/access-grants", { actorId: subject });
      expect((listRes.body as unknown[]).length).toBe(1);

      const revokeRes = await inject(server, "POST", `/v1/me/access-grants/${grantId}/revoke`, {
        actorId: subject,
      });
      expect(revokeRes.statusCode).toBe(204);

      const listAfterRes = await inject(server, "GET", "/v1/me/access-grants", {
        actorId: subject,
      });
      expect((listAfterRes.body as unknown[]).length).toBe(0);
    });
  });
});
