import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  ADMIN_CAPABILITIES,
  type EventEnvelope,
  EventEnvelopeSchema,
  type RoleKey,
  UUIDv7,
} from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/common/decorators/current-actor.decorator.js";
import { AuditRepository } from "../../src/infrastructure/db/repositories/audit.repository.js";
import { IndividualProfilesRepository } from "../../src/infrastructure/db/repositories/individual-profiles.repository.js";
import { OrganizationInvitationsRepository } from "../../src/infrastructure/db/repositories/organization-invitations.repository.js";
import { OrganizationMembershipsRepository } from "../../src/infrastructure/db/repositories/organization-memberships.repository.js";
import { ProfessionalProfilesRepository } from "../../src/infrastructure/db/repositories/professional-profiles.repository.js";
import { RoleAssignmentsRepository } from "../../src/infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../src/infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../src/infrastructure/events/event-publisher.js";
import { InternalRolesService } from "../../src/modules/admin/internal-roles.service.js";
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
  const individualProfiles = new IndividualProfilesRepository(getTestDb());
  const invitations = new OrganizationInvitationsRepository(getTestDb());
  const memberships = new OrganizationMembershipsRepository(getTestDb());
  const auditRepo = new AuditRepository(getTestDb());

  /** Captures every §17 event identity publishes, so a test can assert on it. */
  const published: EventEnvelope[] = [];
  const capturingPublisher: EventPublisher = {
    publish: async (event) => {
      published.push(event);
    },
  };
  const eventsOfType = (eventType: string) => published.filter((e) => e.eventType === eventType);
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

    await roleAssignments.assign({
      userId,
      roleId: await ensureProfessionalRole(),
      assignedBy: userId,
    });

    return userId;
  }

  /** Seeds an internal role if this DB has no catalog entry for it. */
  async function ensureInternalRole(key: RoleKey): Promise<UUIDv7> {
    let role = await roles.findByKey(key);
    if (!role) {
      await roles.seedRole({ key, name: key, scope: "platform", isInternal: true });
      role = await roles.findByKey(key);
    }
    if (!role) throw new Error(`failed to seed ${key}`);
    return role.id;
  }

  /** The `professional` platform role id, seeding the catalog entry if this DB has none. */
  async function ensureProfessionalRole(): Promise<UUIDv7> {
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
    return role.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The real adapter structured-logs the envelope; capturing it here is what
      // lets a test assert what identity actually emits (Checkpoint 14.3).
      .overrideProvider(IDENTITY_EVENT_PUBLISHER)
      .useValue(capturingPublisher)
      .compile();
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
    published.length = 0;
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

  describe("POST /internal/v1/users/resolve (build plan §20 Checkpoint 8.2)", () => {
    it("resolves a linked provider id to the internal Somnus user", async () => {
      const userId = await users.create({ email: "linked@example.com" });
      await users.linkIdentity({ userId, providerUserId: "firebase-uid-abc" });

      const res = await inject(server, "POST", "/internal/v1/users/resolve", {
        payload: { providerUserId: "firebase-uid-abc" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        userId,
        email: "linked@example.com",
        locale: "es",
        status: "active",
      });
    });

    it("404s for a provider id with no linked Somnus account", async () => {
      const res = await inject(server, "POST", "/internal/v1/users/resolve", {
        payload: { providerUserId: "firebase-uid-unknown" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("400s on a malformed body (empty providerUserId)", async () => {
      const res = await inject(server, "POST", "/internal/v1/users/resolve", {
        payload: { providerUserId: "" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /internal/v1/users/provision (build plan §20 Checkpoint 9.1; role branch: Addendum A Checkpoint 14.1)", () => {
    /** The two required purposes, always separate flags -- never one combined value (build plan §13). */
    const CONSENTS = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;

    async function provision(payload: Record<string, unknown>): Promise<JsonResponse> {
      return inject(server, "POST", "/internal/v1/users/provision", { payload });
    }

    /** The Consent module's own public HTTP surface -- this test never reads consent tables. */
    async function consentedPurposes(userId: string): Promise<Map<string, boolean>> {
      const res = await inject(server, "GET", "/v1/consents/current", { actorId: userId });
      expect(res.statusCode).toBe(200);
      const body = res.body as { purposes: { purposeKey: string; consented: boolean }[] };
      return new Map(body.purposes.map((p) => [p.purposeKey, p.consented]));
    }

    it("adult branch: creates the user, links the identity, stores the branch, records one receipt per purpose", async () => {
      const res = await provision({
        providerUserId: "firebase-new-1",
        email: "new@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        locale: "ca",
        role: "adult",
        ageYears: 34,
        consents: CONSENTS,
      });

      expect(res.statusCode).toBe(200);
      const provisioned = res.body as { userId: string; locale: string; status: string };
      expect(provisioned).toMatchObject({ locale: "ca", status: "active" });

      // The identity is now linked and the profile exists: /v1/me composes it.
      const me = await inject(server, "GET", "/v1/me", { actorId: provisioned.userId });
      expect(me.statusCode).toBe(200);
      expect(me.body).toMatchObject({
        user: { email: "new@example.com", locale: "ca" },
        individualProfile: { firstName: "Ada", lastName: "Lovelace" },
      });

      // Field by field on the identity side: the branch is stored, and the
      // guardian-only columns stay null rather than being quietly defaulted.
      const profile = await individualProfiles.findByUser({ userId: provisioned.userId });
      expect(profile?.registrationRole).toBe("adult");
      expect(profile?.guardianshipConfirmed).toBeNull();
      expect(profile?.minorAgeBand).toBeNull();

      const consented = await consentedPurposes(provisioned.userId);
      expect(consented.get("terms_acceptance")).toBe(true);
      expect(consented.get("privacy_policy_acknowledgement")).toBe(true);
      // Health-data consent is deliberately NOT taken at registration: it stays
      // at the first assessment (Addendum A §A3, unchanged from build plan §13).
      expect(consented.get("health_data_processing")).toBe(false);
    });

    it("parent branch: guardianship confirmation and minor age band are persisted verbatim", async () => {
      const res = await provision({
        providerUserId: "firebase-parent-1",
        email: "parent@example.com",
        firstName: "Marie",
        lastName: "Curie",
        locale: "es",
        role: "parent",
        guardianshipConfirmed: true,
        minorAgeBand: "6-12y",
        consents: CONSENTS,
      });
      expect(res.statusCode).toBe(200);
      const { userId } = res.body as { userId: string };

      const profile = await individualProfiles.findByUser({ userId });
      expect(profile?.firstName).toBe("Marie");
      expect(profile?.lastName).toBe("Curie");
      expect(profile?.registrationRole).toBe("parent");
      expect(profile?.guardianshipConfirmed).toBe(true);
      expect(profile?.minorAgeBand).toBe("6-12y");

      // The minor never gets an account (Addendum A §A1): the guardian's own
      // profile is the only row created, and no professional profile appears.
      expect(await professionalProfiles.findByUser({ userId })).toBeNull();

      const consented = await consentedPurposes(userId);
      expect(consented.get("terms_acceptance")).toBe(true);
      expect(consented.get("privacy_policy_acknowledgement")).toBe(true);
    });

    it("professional branch: stores the profile, opens a pending verification case, assigns NO role", async () => {
      const res = await provision({
        providerUserId: "firebase-pro-1",
        email: "pro-branch@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        locale: "en",
        role: "professional",
        specialty: "sleep_physician",
        licenseNumber: "COL-12345",
        consents: CONSENTS,
      });
      expect(res.statusCode).toBe(200);
      const { userId } = res.body as { userId: string };

      const profile = await professionalProfiles.findByUser({ userId });
      expect(profile).not.toBeNull();
      expect(profile?.specialty).toBe("sleep_physician");
      expect(profile?.licenseNumber).toBe("COL-12345");
      expect(profile?.verificationStatus).toBe("pending");

      const cases = await professionalProfiles.listVerificationCases(profile?.id as UUIDv7);
      expect(cases).toHaveLength(1);
      expect(cases[0]?.status).toBe("pending");

      // Addendum A §A1: "a professional who self-registers is a normal
      // individual until verified" -- provisioning must never assign the role.
      const assignments = await roleAssignments.listActiveForUser({ userId });
      expect(assignments).toHaveLength(0);

      // The individual profile still exists with the branch recorded on it.
      const individual = await individualProfiles.findByUser({ userId });
      expect(individual?.registrationRole).toBe("professional");
      expect(individual?.guardianshipConfirmed).toBeNull();
      expect(individual?.minorAgeBand).toBeNull();
    });

    it("is idempotent: provisioning the same provider id returns the same user", async () => {
      const payload = {
        providerUserId: "firebase-dup-1",
        email: "dup@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        role: "adult",
        ageYears: 40,
        consents: CONSENTS,
      };
      const first = await provision(payload);
      const second = await provision(payload);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect((second.body as { userId: string }).userId).toBe(
        (first.body as { userId: string }).userId,
      );
    });

    // --- Negative tests (Addendum A §A3 Checkpoint 14.1) ---

    it("rejects an adult who declares a minor age", async () => {
      const res = await provision({
        providerUserId: "firebase-minor-1",
        email: "minor@example.com",
        firstName: "Too",
        lastName: "Young",
        role: "adult",
        ageYears: 15,
        consents: CONSENTS,
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    });

    it("rejects a guardian who omits the guardianship confirmation", async () => {
      const res = await provision({
        providerUserId: "firebase-noguard-1",
        email: "noguard@example.com",
        firstName: "No",
        lastName: "Confirmation",
        role: "parent",
        minorAgeBand: "3-5y",
        consents: CONSENTS,
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a guardian who sets the guardianship confirmation to false", async () => {
      const res = await provision({
        providerUserId: "firebase-falseguard-1",
        email: "falseguard@example.com",
        firstName: "False",
        lastName: "Confirmation",
        role: "parent",
        guardianshipConfirmed: false,
        minorAgeBand: "3-5y",
        consents: CONSENTS,
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a registration that does not accept both required purposes", async () => {
      const res = await provision({
        providerUserId: "firebase-noconsent-1",
        email: "noconsent@example.com",
        firstName: "No",
        lastName: "Consent",
        role: "adult",
        ageYears: 30,
        consents: { termsAcceptance: true, privacyPolicyAcknowledgement: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an unknown role branch", async () => {
      const res = await provision({
        providerUserId: "firebase-badrole-1",
        email: "badrole@example.com",
        firstName: "Bad",
        lastName: "Role",
        role: "platform_admin",
        consents: CONSENTS,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  /**
   * Addendum A §A1 / §A3 Checkpoint 14.1 negative: a self-declared
   * professional behaves as an individual until a `professional_verifier`
   * approves the case. The proof is the authorization decision itself,
   * taken before and after approval with the identical request -- an
   * access grant already exists in both, so the "before" denial can only
   * come from the missing role, not from a missing grant.
   */
  describe("a self-declared professional has only individual permissions until verified", () => {
    const CONSENTS = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;

    it("clinical access flips from denied to allowed only once the verification case is approved", async () => {
      const provisionRes = await inject(server, "POST", "/internal/v1/users/provision", {
        payload: {
          providerUserId: "firebase-unverified-pro",
          email: "unverified-pro@example.com",
          firstName: "Self",
          lastName: "Declared",
          role: "professional",
          specialty: "psychologist",
          licenseNumber: "LIC-UNVERIFIED",
          consents: CONSENTS,
        },
      });
      expect(provisionRes.statusCode).toBe(200);
      const professional = (provisionRes.body as { userId: string }).userId;

      const subject = await users.create({ email: "pro-subject@example.com" });
      const grantRes = await inject(server, "POST", "/v1/me/access-grants", {
        actorId: subject,
        payload: { professionalUserId: professional, scope: "clinical_data:read" },
      });
      expect(grantRes.statusCode).toBe(201);

      const check = async () =>
        inject(server, "POST", "/internal/v1/authorization/check", {
          payload: {
            actorUserId: professional,
            subjectUserId: subject,
            action: "read_clinical_data",
          },
        });

      // BEFORE approval: the grant exists, the professional role does not.
      const before = await check();
      expect(before.statusCode).toBe(200);
      expect(before.body).toMatchObject({
        allowed: false,
        reasonCode: "DENIED_PERMISSION_NOT_ASSIGNED",
      });

      // ...and they still hold their individual permissions meanwhile.
      const ownData = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: {
          actorUserId: professional,
          subjectUserId: professional,
          action: "read_clinical_data",
        },
      });
      expect(ownData.body).toMatchObject({ allowed: true, reasonCode: "AUTHORIZED_SELF_ACCESS" });

      // Approval, as a `professional_verifier` will perform it in the admin
      // console (Addendum A Checkpoint 15.2): the case is resolved and the
      // platform role is assigned. No HTTP route does this yet in 14.1.
      await professionalProfiles.setVerificationStatus({ userId: professional }, "verified");
      const role = await ensureProfessionalRole();
      await roleAssignments.assign({
        userId: professional,
        roleId: role,
        assignedBy: professional,
      });

      // AFTER approval: the identical request now resolves to the grant.
      const after = await check();
      expect(after.body).toMatchObject({
        allowed: true,
        reasonCode: "AUTHORIZED_BY_ACTIVE_ACCESS_GRANT",
      });
    });
  });

  /**
   * Addendum A §A1 / Checkpoint 14.2: an organization invitation is the only
   * door into Nox. These cover the pre-login preview, the three ways a token
   * can be unusable, the binding to the invited address, and the full path a
   * brand-new invited email takes -- provision on the professional branch,
   * then accept, then membership.
   */
  describe("Nox invitation-only entry (Addendum A Checkpoint 14.2)", () => {
    const CONSENTS = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;

    async function makeOrganization(ownerEmail: string, name = "Nox Research Lab") {
      const owner = await users.create({ email: ownerEmail });
      const res = await inject(server, "POST", "/v1/organizations", {
        actorId: owner,
        payload: { name },
      });
      expect(res.statusCode).toBe(201);
      return { owner, organizationId: (res.body as { id: string }).id, name };
    }

    async function invite(
      owner: string,
      organizationId: string,
      email: string,
      roleKey?: string,
    ): Promise<string> {
      const res = await inject(server, "POST", `/v1/organizations/${organizationId}/invitations`, {
        actorId: owner,
        payload: { email, ...(roleKey ? { roleKey } : {}) },
      });
      expect(res.statusCode).toBe(201);
      return (res.body as { token: string }).token;
    }

    const preview = (token: string) =>
      inject(server, "POST", "/internal/v1/invitations/preview", { payload: { token } });

    const accept = (actorId: string, token: string) =>
      inject(server, "POST", "/v1/invitations/accept", { actorId, payload: { token } });

    /** Provisions a brand-new invited person exactly as the SPA does: professional branch. */
    async function provisionInvitedProfessional(email: string, providerUserId: string) {
      const res = await inject(server, "POST", "/internal/v1/users/provision", {
        payload: {
          providerUserId,
          email,
          firstName: "Rosalind",
          lastName: "Franklin",
          role: "professional",
          specialty: "sleep_physician",
          licenseNumber: "COL-NOX-1",
          consents: CONSENTS,
        },
      });
      expect(res.statusCode).toBe(200);
      return (res.body as { userId: string }).userId;
    }

    it("preview returns the organization name, the invited email and the expiry -- and nothing else", async () => {
      const { owner, organizationId, name } = await makeOrganization("nox-owner@example.com");
      const token = await invite(owner, organizationId, "invited@example.com");

      const res = await preview(token);
      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["organizationName"]).toBe(name);
      expect(body["email"]).toBe("invited@example.com");
      expect(typeof body["expiresAt"]).toBe("string");

      // An unauthenticated caller must not learn the organization id, the
      // role, or who issued the invitation.
      expect(Object.keys(body).sort()).toEqual(["email", "expiresAt", "organizationName"]);
    });

    it("preview needs no actor at all -- the invited person has no session yet", async () => {
      const { owner, organizationId } = await makeOrganization("nox-owner-2@example.com");
      const token = await invite(owner, organizationId, "no-session@example.com");

      // No ACTOR_ID_HEADER anywhere in this request.
      const res = await preview(token);
      expect(res.statusCode).toBe(200);
    });

    it("rejects an unknown token with INVITATION_NOT_FOUND", async () => {
      const res = await preview("this-token-never-existed");
      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({ error: { code: "INVITATION_NOT_FOUND" } });
    });

    it("rejects an expired invitation, on preview AND on accept", async () => {
      const { organizationId } = await makeOrganization("nox-owner-3@example.com");
      const invitee = await users.create({ email: "expired-invitee@example.com" });

      // Straight to the repository: the HTTP create path always mints a 72h
      // TTL, and what is under test is a token whose deadline has passed.
      const { token } = await invitations.create({
        organizationId,
        email: "expired-invitee@example.com",
        invitedBy: invitee,
        expiresAt: new Date(Date.now() - 60_000),
      });

      const previewRes = await preview(token);
      expect(previewRes.statusCode).toBe(410);
      expect(previewRes.body).toMatchObject({ error: { code: "INVITATION_EXPIRED" } });

      // The row is still `pending`, so only the expiry check stands between
      // this token and a membership.
      const acceptRes = await accept(invitee, token);
      expect(acceptRes.statusCode).toBe(410);
      expect(acceptRes.body).toMatchObject({ error: { code: "INVITATION_EXPIRED" } });

      const members = await inject(server, "GET", `/v1/organizations/${organizationId}/members`, {
        actorId: invitee,
      });
      expect(members.statusCode).toBe(403);
    });

    it("rejects a reused invitation, on preview AND on accept", async () => {
      const { owner, organizationId } = await makeOrganization("nox-owner-4@example.com");
      const invitee = await users.create({ email: "reuse-invitee@example.com" });
      const token = await invite(owner, organizationId, "reuse-invitee@example.com");

      expect((await accept(invitee, token)).statusCode).toBe(201);

      const previewRes = await preview(token);
      expect(previewRes.statusCode).toBe(409);
      expect(previewRes.body).toMatchObject({ error: { code: "INVITATION_ALREADY_USED" } });

      const replayRes = await accept(invitee, token);
      expect(replayRes.statusCode).toBe(409);
      expect(replayRes.body).toMatchObject({ error: { code: "INVITATION_ALREADY_USED" } });
    });

    it("refuses an account whose email is not the invited one", async () => {
      const { owner, organizationId } = await makeOrganization("nox-owner-5@example.com");
      const stranger = await users.create({ email: "stranger@example.com" });
      const token = await invite(owner, organizationId, "meant-for-someone-else@example.com");

      const res = await accept(stranger, token);
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ error: { code: "INVITATION_EMAIL_MISMATCH" } });

      // Holding the token got them nowhere: no membership was created, and
      // the token is still unused for the person it was actually meant for.
      const roster = await inject(server, "GET", `/v1/organizations/${organizationId}/members`, {
        actorId: owner,
      });
      expect((roster.body as unknown[]).length).toBe(1);
      expect((await preview(token)).statusCode).toBe(200);
    });

    it("matches the invited address case-insensitively", async () => {
      const { owner, organizationId } = await makeOrganization("nox-owner-6@example.com");
      const invitee = await users.create({ email: "MixedCase@Example.com" });
      const token = await invite(owner, organizationId, "mixedcase@example.com");

      expect((await accept(invitee, token)).statusCode).toBe(201);
    });

    it("a brand-new invited email registers on the professional branch and lands in the organization", async () => {
      const { owner, organizationId } = await makeOrganization("nox-owner-7@example.com");
      const token = await invite(owner, organizationId, "brand-new@example.com");

      // 1. Before any account exists, the accept screen can already tell them
      //    who invited them.
      expect((await preview(token)).statusCode).toBe(200);

      // 2. Magic link, then registration -- branch locked to professional.
      const invitee = await provisionInvitedProfessional("brand-new@example.com", "firebase-nox-1");

      // 3. Accept attaches the membership.
      const acceptRes = await accept(invitee, token);
      expect(acceptRes.statusCode).toBe(201);
      expect((acceptRes.body as { status: string }).status).toBe("accepted");

      const roster = await inject(server, "GET", `/v1/organizations/${organizationId}/members`, {
        actorId: owner,
      });
      const members = roster.body as Array<{ userId: string; status: string }>;
      expect(members.map((m) => m.userId)).toContain(invitee);
      expect(members.find((m) => m.userId === invitee)?.status).toBe("active");

      // The professional profile is still unverified: joining an organization
      // is not the same as being a verified professional (Addendum A §A1).
      const profile = await professionalProfiles.findByUser({ userId: invitee });
      expect(profile?.verificationStatus).toBe("pending");
    });

    it("an invitation-granted professional role does NOT bypass the 14.1 verification gate", async () => {
      const { owner, organizationId } = await makeOrganization("nox-owner-8@example.com");
      await ensureProfessionalRole();
      const token = await invite(owner, organizationId, "role-invited@example.com", "professional");

      const invitee = await provisionInvitedProfessional(
        "role-invited@example.com",
        "firebase-nox-2",
      );
      expect((await accept(invitee, token)).statusCode).toBe(201);

      // They now hold the `professional` role in this organization...
      const assignments = await roleAssignments.listActiveForUser({ userId: invitee });
      expect(assignments.length).toBeGreaterThan(0);

      // ...and a subject has granted them clinical access. Verification is the
      // only thing still missing, and it is enough to deny.
      const subject = await users.create({ email: "nox-subject@example.com" });
      const grantRes = await inject(server, "POST", "/v1/me/access-grants", {
        actorId: subject,
        payload: { professionalUserId: invitee, scope: "clinical_data:read" },
      });
      expect(grantRes.statusCode).toBe(201);

      const decision = await inject(server, "POST", "/internal/v1/authorization/check", {
        payload: {
          actorUserId: invitee,
          subjectUserId: subject,
          action: "read_clinical_data",
        },
      });
      expect(decision.body).toMatchObject({
        allowed: false,
        reasonCode: "DENIED_PROFESSIONAL_NOT_VERIFIED",
      });
    });
  });

  /**
   * Addendum A Checkpoint 14.3: the analytics events behind the Phase 15
   * dashboards. These assert what identity actually puts on the wire for each
   * role branch and each invitation stage -- and, just as importantly, what it
   * does NOT put there.
   */
  describe("registration and funnel events (Addendum A Checkpoint 14.3)", () => {
    const CONSENTS = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;

    async function provision(payload: Record<string, unknown>): Promise<JsonResponse> {
      return inject(server, "POST", "/internal/v1/users/provision", { payload });
    }

    it.each([
      [
        "adult",
        {
          firstName: "Ada",
          lastName: "Lovelace",
          role: "adult",
          ageYears: 34,
        },
      ],
      [
        "parent",
        {
          firstName: "Marie",
          lastName: "Curie",
          role: "parent",
          guardianshipConfirmed: true,
          minorAgeBand: "6-12y",
        },
      ],
      [
        "professional",
        {
          firstName: "Grace",
          lastName: "Hopper",
          role: "professional",
          specialty: "sleep_physician",
          licenseNumber: "COL-14-3",
        },
      ],
    ])(
      "emits started and completed for the %s branch, carrying only the role branch",
      async (branch, branchFields) => {
        const res = await provision({
          providerUserId: `firebase-events-${branch}`,
          email: `events-${branch}@example.com`,
          locale: "es",
          consents: CONSENTS,
          ...branchFields,
        });
        expect(res.statusCode).toBe(200);
        const { userId } = res.body as { userId: string };

        const started = eventsOfType("identity.registration.started.v1");
        const completed = eventsOfType("identity.registration.completed.v1");
        expect(started).toHaveLength(1);
        expect(completed).toHaveLength(1);

        for (const event of [...started, ...completed]) {
          // Valid §17 envelope, with the opaque user id as the subject.
          expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
          expect(event.producer).toBe("somnus-identity-service");
          expect(event.subject.type).toBe("user");
          // The role branch and NOTHING else: no name, no email, no locale text.
          expect(event.data).toEqual({ roleBranch: branch });
        }

        expect(completed[0]?.subject.id).toBe(userId);

        // Not a single personal value anywhere in what was published.
        const serialized = JSON.stringify(published);
        expect(serialized).not.toContain(`events-${branch}@example.com`);
        expect(serialized).not.toContain(branchFields.firstName);
        expect(serialized).not.toContain(branchFields.lastName);
      },
    );

    it("opens the verification funnel only for the professional branch", async () => {
      await provision({
        providerUserId: "firebase-events-noverif",
        email: "noverif@example.com",
        firstName: "No",
        lastName: "Case",
        role: "adult",
        ageYears: 30,
        consents: CONSENTS,
      });
      expect(eventsOfType("identity.professional.verification.requested.v1")).toHaveLength(0);

      published.length = 0;
      const res = await provision({
        providerUserId: "firebase-events-verif",
        email: "verif@example.com",
        firstName: "Rosalind",
        lastName: "Franklin",
        role: "professional",
        specialty: "psychologist",
        licenseNumber: "COL-14-3-B",
        consents: CONSENTS,
      });
      const { userId } = res.body as { userId: string };

      const requested = eventsOfType("identity.professional.verification.requested.v1");
      expect(requested).toHaveLength(1);
      expect(Object.keys(requested[0]?.data ?? {})).toEqual(["caseId"]);

      // The caseId is the real one, so the funnel joins to a case that exists.
      const profile = await professionalProfiles.findByUser({ userId });
      const cases = await professionalProfiles.listVerificationCases(profile?.id as UUIDv7);
      expect(requested[0]?.data["caseId"]).toBe(cases[0]?.id);
    });

    it("re-submitting an existing registration completes the funnel, never starts a second user", async () => {
      const payload = {
        providerUserId: "firebase-events-dup",
        email: "dup-events@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "adult",
        ageYears: 34,
        consents: CONSENTS,
      };
      await provision(payload);
      published.length = 0;
      await provision(payload);

      expect(eventsOfType("identity.registration.started.v1")).toHaveLength(1);
      expect(eventsOfType("identity.registration.completed.v1")).toHaveLength(1);
    });

    it("emits the invitation funnel: created, previewed, accepted -- with no email anywhere", async () => {
      const owner = await users.create({ email: "funnel-owner@example.com" });
      const orgRes = await inject(server, "POST", "/v1/organizations", {
        actorId: owner,
        payload: { name: "Funnel Lab" },
      });
      const organizationId = (orgRes.body as { id: string }).id;

      published.length = 0;
      const inviteRes = await inject(
        server,
        "POST",
        `/v1/organizations/${organizationId}/invitations`,
        { actorId: owner, payload: { email: "funnel-invitee@example.com" } },
      );
      const { token, invitation } = inviteRes.body as {
        token: string;
        invitation: { id: string };
      };

      const created = eventsOfType("identity.organization.invitation.created.v1");
      expect(created).toHaveLength(1);
      expect(created[0]?.data).toEqual({ invitationId: invitation.id });

      await inject(server, "POST", "/internal/v1/invitations/preview", { payload: { token } });
      expect(eventsOfType("identity.organization.invitation.previewed.v1")).toHaveLength(1);

      const invitee = await users.create({ email: "funnel-invitee@example.com" });
      const acceptRes = await inject(server, "POST", "/v1/invitations/accept", {
        actorId: invitee,
        payload: { token },
      });
      expect(acceptRes.statusCode).toBe(201);
      const accepted = eventsOfType("identity.organization.invitation.accepted.v1");
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.data).toEqual({ invitationId: invitation.id });

      // The invited address is the whole point of an invitation, and it is the
      // one thing that must never reach analytics.
      expect(JSON.stringify(published)).not.toContain("funnel-invitee@example.com");
      expect(JSON.stringify(published)).not.toContain("Funnel Lab");
    });

    it("emits an expiry where the refusal happens, tagged with the stage", async () => {
      const owner = await users.create({ email: "expiry-owner@example.com" });
      const orgRes = await inject(server, "POST", "/v1/organizations", {
        actorId: owner,
        payload: { name: "Expiry Lab" },
      });
      const organizationId = (orgRes.body as { id: string }).id;

      const { id, token } = await invitations.create({
        organizationId,
        email: "expired-funnel@example.com",
        invitedBy: owner,
        expiresAt: new Date(Date.now() - 60_000),
      });

      published.length = 0;
      await inject(server, "POST", "/internal/v1/invitations/preview", { payload: { token } });
      await inject(server, "POST", "/v1/invitations/accept", {
        actorId: owner,
        payload: { token },
      });

      const expired = eventsOfType("identity.organization.invitation.expired.v1");
      expect(expired).toHaveLength(2);
      expect(expired.map((e) => e.data["stage"])).toEqual(["preview", "accept"]);
      for (const event of expired) {
        expect(event.data["invitationId"]).toBe(id);
      }
      // An expired invitation never counts as previewed or accepted.
      expect(eventsOfType("identity.organization.invitation.previewed.v1")).toHaveLength(0);
      expect(eventsOfType("identity.organization.invitation.accepted.v1")).toHaveLength(0);
    });
  });

  /**
   * Addendum A §A5.4 / Checkpoint 15.2: the one path by which an internal role
   * is granted. The bootstrap and the console share it, so the invariants below
   * hold for both -- and the confirmation is the authorization service's own
   * answer, not the assignment's return value.
   */
  describe("internal role assignment (bootstrap and console share one path)", () => {
    const rolesService = () =>
      new InternalRolesService(
        users,
        roles,
        roleAssignments,
        capturingPublisher as unknown as ConstructorParameters<typeof InternalRolesService>[3],
      );

    async function seedInternalRole(key: RoleKey): Promise<UUIDv7> {
      let role = await roles.findByKey(key);
      if (!role) {
        await roles.seedRole({ key, name: key, scope: "platform", isInternal: true });
        role = await roles.findByKey(key);
      }
      if (!role) throw new Error(`failed to seed ${key}`);
      return role.id;
    }

    const adminContext = (actorUserId: string) =>
      inject(server, "POST", "/internal/v1/authorization/admin-context", {
        payload: { actorUserId },
      });

    it("bootstrap grants the first super admin, and the authorization service confirms it", async () => {
      await seedInternalRole("platform_super_admin");
      const person = await users.create({ email: "first-admin@example.com" });

      // Before: an ordinary account, no console access at all.
      const before = await adminContext(person);
      expect(before.body).toEqual({ roleKeys: [], capabilities: [] });

      const result = await rolesService().assignInternalRole({
        targetUserId: person,
        roleKey: "platform_super_admin",
        source: { kind: "bootstrap" },
        correlationId: "bootstrap-test",
      });
      expect(result.source).toBe("bootstrap");

      // After: confirmed by asking the authorization service, which is exactly
      // what the console asks -- not by trusting the assignment's own return.
      const after = await adminContext(person);
      const body = after.body as { roleKeys: string[]; capabilities: string[] };
      expect(body.roleKeys).toEqual(["platform_super_admin"]);
      expect(body.capabilities).toEqual([...ADMIN_CAPABILITIES]);
    });

    it("records the grant with NO assigner, so it can never read as a self-assignment", async () => {
      await seedInternalRole("platform_super_admin");
      const person = await users.create({ email: "no-assigner@example.com" });

      await rolesService().assignInternalRole({
        targetUserId: person,
        roleKey: "platform_super_admin",
        source: { kind: "bootstrap" },
        correlationId: "bootstrap-test",
      });

      const held = await roleAssignments.listActiveForUser({ userId: person });
      expect(held).toHaveLength(1);
      // NULL, not the grantee's own id: there was no acting admin.
      expect(held[0]?.assignedBy).toBeNull();
    });

    it("audits the grant as a bootstrap, visibly different from a console assignment", async () => {
      await seedInternalRole("platform_super_admin");
      const person = await users.create({ email: "audited-bootstrap@example.com" });
      published.length = 0;

      await rolesService().assignInternalRole({
        targetUserId: person,
        roleKey: "platform_super_admin",
        source: { kind: "bootstrap" },
        correlationId: "bootstrap-test",
      });

      const events = published.filter((e) => e.eventType === "admin.internal_role.assigned.v1");
      expect(events).toHaveLength(1);
      expect(EventEnvelopeSchema.safeParse(events[0]).success).toBe(true);
      expect(events[0]?.data["source"]).toBe("bootstrap");
      expect(events[0]?.data["roleKey"]).toBe("platform_super_admin");
      // No acting admin to attribute it to.
      expect(events[0]?.actor).toBeUndefined();
      expect(events[0]?.subject).toEqual({ type: "user", id: person });
    });

    it("closes after the first super admin exists: the script is not a standing backdoor", async () => {
      await seedInternalRole("platform_super_admin");
      const first = await users.create({ email: "bootstrap-first@example.com" });
      const second = await users.create({ email: "bootstrap-second@example.com" });

      await rolesService().assignInternalRole({
        targetUserId: first,
        roleKey: "platform_super_admin",
        source: { kind: "bootstrap" },
        correlationId: "bootstrap-test",
      });

      await expect(
        rolesService().assignInternalRole({
          targetUserId: second,
          roleKey: "platform_super_admin",
          source: { kind: "bootstrap" },
          correlationId: "bootstrap-test",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect((await adminContext(second)).body).toEqual({ roleKeys: [], capabilities: [] });
    });

    it.each(["support_agent", "platform_admin", "professional_verifier"] as const)(
      "bootstrap refuses to grant %s: it exists to create the first super admin, nothing else",
      async (roleKey) => {
        await seedInternalRole(roleKey);
        const person = await users.create({ email: `bootstrap-${roleKey}@example.com` });

        await expect(
          rolesService().assignInternalRole({
            targetUserId: person,
            roleKey,
            source: { kind: "bootstrap" },
            correlationId: "bootstrap-test",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      },
    );

    it("never creates an account for an address that has not registered", async () => {
      await seedInternalRole("platform_super_admin");
      const before = (await users.findByEmail("never-registered@example.com")) ?? null;
      expect(before).toBeNull();

      await expect(
        rolesService().assignInternalRole({
          targetUserId: UUIDv7(),
          roleKey: "platform_super_admin",
          source: { kind: "bootstrap" },
          correlationId: "bootstrap-test",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(await users.findByEmail("never-registered@example.com")).toBeNull();
    });

    it("refuses a suspended account", async () => {
      await seedInternalRole("platform_super_admin");
      const person = await users.create({ email: "suspended-admin@example.com" });
      await users.setStatus(person, "suspended");

      await expect(
        rolesService().assignInternalRole({
          targetUserId: person,
          roleKey: "platform_super_admin",
          source: { kind: "bootstrap" },
          correlationId: "bootstrap-test",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    // --- The console path: the immutable 6.3 negative, extended ---

    it("a super admin cannot assign a privileged role to THEMSELVES", async () => {
      await seedInternalRole("platform_super_admin");
      await seedInternalRole("platform_admin");
      const admin = await users.create({ email: "self-assigner@example.com" });
      await rolesService().assignInternalRole({
        targetUserId: admin,
        roleKey: "platform_super_admin",
        source: { kind: "bootstrap" },
        correlationId: "bootstrap-test",
      });

      // Escalation must pass through a second person, even for the most
      // privileged role on the platform.
      await expect(
        rolesService().assignInternalRole({
          targetUserId: admin,
          roleKey: "platform_admin",
          source: { kind: "console", actingAdminUserId: admin },
          correlationId: "console-test",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const held = await roleAssignments.listActiveForUser({ userId: admin });
      expect(held).toHaveLength(1);
    });

    it("a super admin CAN assign a role to someone else, recorded with them as the assigner", async () => {
      await seedInternalRole("platform_super_admin");
      await seedInternalRole("support_agent");
      const admin = await users.create({ email: "granting-admin@example.com" });
      const agent = await users.create({ email: "new-agent@example.com" });
      await rolesService().assignInternalRole({
        targetUserId: admin,
        roleKey: "platform_super_admin",
        source: { kind: "bootstrap" },
        correlationId: "bootstrap-test",
      });

      published.length = 0;
      await rolesService().assignInternalRole({
        targetUserId: agent,
        roleKey: "support_agent",
        source: { kind: "console", actingAdminUserId: admin },
        correlationId: "console-test",
      });

      const held = await roleAssignments.listActiveForUser({ userId: agent });
      expect(held[0]?.assignedBy).toBe(admin);

      const events = published.filter((e) => e.eventType === "admin.internal_role.assigned.v1");
      expect(events[0]?.data["source"]).toBe("console");
      expect(events[0]?.actor).toEqual({ type: "user", id: admin });

      const context = (await adminContext(agent)).body as { capabilities: string[] };
      expect(context.capabilities).toEqual([
        "admin_users_read",
        "admin_statistics_read",
        "admin_consent_read",
      ]);
    });

    it.each(["individual_user", "professional", "organization_owner"] as const)(
      "refuses to hand out the external role %s: those are earned, not granted",
      async (roleKey) => {
        const admin = await users.create({ email: `ext-${roleKey}@example.com` });
        const target = await users.create({ email: `ext-target-${roleKey}@example.com` });

        await expect(
          rolesService().assignInternalRole({
            targetUserId: target,
            roleKey,
            source: { kind: "console", actingAdminUserId: admin },
            correlationId: "console-test",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      },
    );

    it("refuses a role the user already holds", async () => {
      await seedInternalRole("support_agent");
      const admin = await users.create({ email: "dup-admin@example.com" });
      const agent = await users.create({ email: "dup-agent@example.com" });
      await rolesService().assignInternalRole({
        targetUserId: agent,
        roleKey: "support_agent",
        source: { kind: "console", actingAdminUserId: admin },
        correlationId: "console-test",
      });

      await expect(
        rolesService().assignInternalRole({
          targetUserId: agent,
          roleKey: "support_agent",
          source: { kind: "console", actingAdminUserId: admin },
          correlationId: "console-test",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  /**
   * Addendum A Checkpoint 15.2 exit criterion: "a real professional goes from
   * `pending` to verified through the console and gains professional
   * permissions, proven end-to-end."
   *
   * Proven by the authorization service's own answer to the identical question,
   * before and after -- not by reading the row the approval wrote.
   */
  describe("admin console operations (Addendum A Checkpoint 15.2)", () => {
    const CONSENTS = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;

    const adminGet = (path: string, actorId: string) => inject(server, "GET", path, { actorId });
    const adminPost = (path: string, actorId: string, payload: unknown) =>
      inject(server, "POST", path, { actorId, payload });
    const adminPatch = (path: string, actorId: string, payload: unknown) =>
      inject(server, "PATCH", path, { actorId, payload });

    /** Registers a professional exactly as the SPA does, leaving a pending case. */
    async function registerProfessional(email: string, providerUserId: string): Promise<string> {
      const res = await inject(server, "POST", "/internal/v1/users/provision", {
        payload: {
          providerUserId,
          email,
          firstName: "Rosalind",
          lastName: "Franklin",
          role: "professional",
          specialty: "sleep_physician",
          licenseNumber: "COL-15-2",
          consents: CONSENTS,
        },
      });
      expect(res.statusCode).toBe(200);
      return (res.body as { userId: string }).userId;
    }

    it("a professional goes from pending to verified through the queue and gains permissions", async () => {
      await ensureProfessionalRole();
      const verifier = await users.create({ email: "verifier-15-2@example.com" });
      const professional = await registerProfessional("pro-15-2@example.com", "firebase-15-2");
      const subject = await users.create({ email: "subject-15-2@example.com" });

      // The subject has granted access, so the ONLY thing standing between the
      // professional and the data is verification.
      const grant = await inject(server, "POST", "/v1/me/access-grants", {
        actorId: subject,
        payload: { professionalUserId: professional, scope: "clinical_data:read" },
      });
      expect(grant.statusCode).toBe(201);

      const decision = () =>
        inject(server, "POST", "/internal/v1/authorization/check", {
          payload: {
            actorUserId: professional,
            subjectUserId: subject,
            action: "read_clinical_data",
          },
        });

      // BEFORE: self-declared, unverified, no role.
      expect((await decision()).body).toMatchObject({
        allowed: false,
        reasonCode: "DENIED_PERMISSION_NOT_ASSIGNED",
      });

      // The verifier sees the case in the queue, with what they need to verify.
      const queue = await adminGet("/internal/v1/admin/verification-cases", verifier);
      expect(queue.statusCode).toBe(200);
      const cases = queue.body as Array<{ caseId: string; userId: string; licenseNumber: string }>;
      const target = cases.find((c) => c.userId === professional);
      expect(target).toBeDefined();
      expect(target?.licenseNumber).toBe("COL-15-2");

      // Approve, with a reason.
      const approved = await adminPost(
        `/internal/v1/admin/verification-cases/${target?.caseId}/decision`,
        verifier,
        { decision: "approve", reason: "Licence checked against the professional register." },
      );
      expect(approved.statusCode).toBe(200);
      expect((approved.body as { status: string }).status).toBe("approved");

      // AFTER: the identical question now resolves to the grant.
      expect((await decision()).body).toMatchObject({
        allowed: true,
        reasonCode: "AUTHORIZED_BY_ACTIVE_ACCESS_GRANT",
      });

      // And the case has left the queue.
      const after = await adminGet("/internal/v1/admin/verification-cases", verifier);
      expect(
        (after.body as Array<{ userId: string }>).find((c) => c.userId === professional),
      ).toBeUndefined();
    });

    it("rejecting leaves the professional with individual permissions only", async () => {
      await ensureProfessionalRole();
      const verifier = await users.create({ email: "verifier-reject@example.com" });
      const professional = await registerProfessional("pro-reject@example.com", "firebase-reject");

      const queue = await adminGet("/internal/v1/admin/verification-cases", verifier);
      const target = (queue.body as Array<{ caseId: string; userId: string }>).find(
        (c) => c.userId === professional,
      );

      const rejected = await adminPost(
        `/internal/v1/admin/verification-cases/${target?.caseId}/decision`,
        verifier,
        { decision: "reject", reason: "Licence number does not match the register." },
      );
      expect(rejected.statusCode).toBe(200);
      expect((rejected.body as { status: string }).status).toBe("rejected");

      // No professional role was granted.
      const assignments = await roleAssignments.listActiveForUser({ userId: professional });
      expect(assignments).toHaveLength(0);

      const profile = await professionalProfiles.findByUser({ userId: professional });
      expect(profile?.verificationStatus).toBe("rejected");
    });

    it("a decided case cannot be decided again by a second verifier", async () => {
      await ensureProfessionalRole();
      const first = await users.create({ email: "verifier-a@example.com" });
      const second = await users.create({ email: "verifier-b@example.com" });
      const professional = await registerProfessional("pro-race@example.com", "firebase-race");

      const queue = await adminGet("/internal/v1/admin/verification-cases", first);
      const target = (queue.body as Array<{ caseId: string; userId: string }>).find(
        (c) => c.userId === professional,
      );

      expect(
        (
          await adminPost(
            `/internal/v1/admin/verification-cases/${target?.caseId}/decision`,
            first,
            {
              decision: "approve",
              reason: "Verified.",
            },
          )
        ).statusCode,
      ).toBe(200);

      // The second verifier's screen was stale; their decision must not
      // overwrite the first.
      const again = await adminPost(
        `/internal/v1/admin/verification-cases/${target?.caseId}/decision`,
        second,
        { decision: "reject", reason: "Disagree." },
      );
      expect(again.statusCode).toBe(409);
    });

    it("a decision without a reason is refused, for approvals as well as rejections", async () => {
      const verifier = await users.create({ email: "verifier-noreason@example.com" });
      const professional = await registerProfessional("pro-noreason@example.com", "firebase-nr");
      const queue = await adminGet("/internal/v1/admin/verification-cases", verifier);
      const target = (queue.body as Array<{ caseId: string; userId: string }>).find(
        (c) => c.userId === professional,
      );

      for (const decision of ["approve", "reject"] as const) {
        const res = await adminPost(
          `/internal/v1/admin/verification-cases/${target?.caseId}/decision`,
          verifier,
          { decision },
        );
        expect(res.statusCode, decision).toBe(400);
      }
    });

    // --- Users -----------------------------------------------------------

    it("searches accounts by address and bounds the result", async () => {
      const admin = await users.create({ email: "admin-search@example.com" });
      for (let i = 0; i < 3; i++) {
        await users.create({ email: `needle-${i}@example.com` });
      }

      const res = await adminPost("/internal/v1/admin/users/search", admin, {
        email: "needle-",
        limit: 2,
      });
      expect(res.statusCode).toBe(200);
      const body = res.body as { users: Array<{ email: string }>; truncated: boolean };
      expect(body.users).toHaveLength(2);
      // Cut off, and it says so rather than silently hiding the third.
      expect(body.truncated).toBe(true);
    });

    it("shows one account's metadata, and nothing clinical", async () => {
      const admin = await users.create({ email: "admin-detail@example.com" });
      const professional = await registerProfessional("detail-pro@example.com", "firebase-detail");

      const res = await adminGet(`/internal/v1/admin/users/${professional}`, admin);
      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;

      expect(Object.keys(body).sort()).toEqual([
        "individualProfile",
        "internalRoles",
        "organizationIds",
        "professionalProfile",
        "user",
      ]);
      expect(body["professionalProfile"]).toMatchObject({ verificationStatus: "pending" });
      // Administrative access is not clinical access (§A2.3).
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("assessment");
      expect(serialized).not.toContain("answer");
    });

    it("suspends and reactivates an account, recording who and why", async () => {
      const admin = await users.create({ email: "admin-status@example.com" });
      const target = await users.create({ email: "to-suspend@example.com" });

      const suspend = await adminPatch(`/internal/v1/admin/users/${target}/status`, admin, {
        status: "suspended",
        reason: "Abuse report under investigation.",
      });
      expect(suspend.statusCode).toBe(200);
      expect((await users.findById(target))?.status).toBe("suspended");

      const history = await auditRepo.listStatusHistory({ userId: target });
      expect(history[0]).toMatchObject({
        previousStatus: "active",
        newStatus: "suspended",
        reason: "Abuse report under investigation.",
        changedBy: admin,
      });

      const reactivate = await adminPatch(`/internal/v1/admin/users/${target}/status`, admin, {
        status: "active",
        reason: "Investigation closed, no action.",
      });
      expect(reactivate.statusCode).toBe(200);
      expect((await users.findById(target))?.status).toBe("active");
    });

    it("refuses a status change with no reason, and a no-op change", async () => {
      const admin = await users.create({ email: "admin-noreason@example.com" });
      const target = await users.create({ email: "already-active@example.com" });

      expect(
        (
          await adminPatch(`/internal/v1/admin/users/${target}/status`, admin, {
            status: "suspended",
          })
        ).statusCode,
      ).toBe(400);

      expect(
        (
          await adminPatch(`/internal/v1/admin/users/${target}/status`, admin, {
            status: "active",
            reason: "Already active.",
          })
        ).statusCode,
      ).toBe(409);
    });

    // --- Organizations ---------------------------------------------------

    it("creates an organization WITHOUT making the admin a member of it", async () => {
      const admin = await users.create({ email: "admin-orgs@example.com" });

      const created = await adminPost("/internal/v1/admin/organizations", admin, {
        name: "Nox Institute",
      });
      expect(created.statusCode).toBe(201);
      const organizationId = (created.body as { id: string }).id;

      // An operator setting an organization up for a customer must not silently
      // join it (§A1: created by a platform admin, not owned by them).
      const members = await adminGet(
        `/internal/v1/admin/organizations/${organizationId}/members`,
        admin,
      );
      expect(members.body).toEqual([]);
    });

    it("suspends and re-approves an organization with a recorded reason", async () => {
      const admin = await users.create({ email: "admin-orgstatus@example.com" });
      const created = await adminPost("/internal/v1/admin/organizations", admin, {
        name: "Suspendable Lab",
      });
      const organizationId = (created.body as { id: string }).id;

      const suspended = await adminPatch(
        `/internal/v1/admin/organizations/${organizationId}/status`,
        admin,
        { status: "suspended", reason: "Contract lapsed." },
      );
      expect(suspended.statusCode).toBe(200);
      expect((suspended.body as { status: string }).status).toBe("suspended");

      const approved = await adminPatch(
        `/internal/v1/admin/organizations/${organizationId}/status`,
        admin,
        { status: "active", reason: "Contract renewed." },
      );
      expect((approved.body as { status: string }).status).toBe("active");
    });

    it("lists organizations and their members", async () => {
      const admin = await users.create({ email: "admin-orglist@example.com" });
      const created = await adminPost("/internal/v1/admin/organizations", admin, {
        name: "Listed Lab",
      });
      const organizationId = (created.body as { id: string }).id;
      const member = await users.create({ email: "org-member@example.com" });
      await memberships.create({ organizationId, userId: member });

      const list = await adminGet("/internal/v1/admin/organizations", admin);
      expect((list.body as Array<{ id: string }>).map((o) => o.id)).toContain(organizationId);

      const roster = await adminGet(
        `/internal/v1/admin/organizations/${organizationId}/members`,
        admin,
      );
      expect((roster.body as Array<{ userId: string }>).map((m) => m.userId)).toEqual([member]);
    });

    // --- Internal role assignment through the route -----------------------

    it("assigns an internal role through the console route", async () => {
      await ensureInternalRole("support_agent");
      const superAdmin = await users.create({ email: "route-super@example.com" });
      const target = await users.create({ email: "route-agent@example.com" });

      const res = await adminPost("/internal/v1/admin/roles/assign", superAdmin, {
        targetUserId: target,
        roleKey: "support_agent",
      });
      expect(res.statusCode).toBe(201);
      expect(res.body).toMatchObject({ roleKey: "support_agent", source: "console" });

      const context = await inject(server, "POST", "/internal/v1/authorization/admin-context", {
        payload: { actorUserId: target },
      });
      expect((context.body as { roleKeys: string[] }).roleKeys).toEqual(["support_agent"]);
    });

    it("REFUSES self-assignment through the admin route (immutable negative from 6.3, extended)", async () => {
      await ensureInternalRole("platform_super_admin");
      const superAdmin = await users.create({ email: "route-selfassign@example.com" });

      const res = await adminPost("/internal/v1/admin/roles/assign", superAdmin, {
        targetUserId: superAdmin,
        roleKey: "platform_super_admin",
      });
      expect(res.statusCode).toBe(403);

      const context = await inject(server, "POST", "/internal/v1/authorization/admin-context", {
        payload: { actorUserId: superAdmin },
      });
      expect((context.body as { roleKeys: string[] }).roleKeys).toEqual([]);
    });

    it.each(["individual_user", "professional"] as const)(
      "refuses to hand out the external role %s through the admin route",
      async (roleKey) => {
        const superAdmin = await users.create({ email: `route-ext-${roleKey}@example.com` });
        const target = await users.create({ email: `route-exttarget-${roleKey}@example.com` });

        const res = await adminPost("/internal/v1/admin/roles/assign", superAdmin, {
          targetUserId: target,
          roleKey,
        });
        expect(res.statusCode).toBe(403);
      },
    );
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
