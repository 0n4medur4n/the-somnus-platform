import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import {
  IndividualProfilesRepository,
  ProfessionalProfilesRepository,
  RoleAssignmentsRepository,
  RolesRepository,
  UsersRepository,
} from "../../src/infrastructure/db/repositories/index.js";
import { PlatformInvitationsRepository } from "../../src/infrastructure/db/repositories/platform-invitations.repository.js";
import { platformInvitations } from "../../src/infrastructure/db/schema/index.js";
import { ConsentService } from "../../src/modules/consent/consent.service.js";
import { PlatformInvitationsService } from "../../src/modules/platform-invitations/platform-invitations.service.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

const input = {
  firstName: "Ana",
  lastName: "Garcia",
  email: "ana@example.com",
  role: "professional" as const,
  locale: "ca" as const,
};
const registration = {
  firstName: "Ana",
  lastName: "Garcia",
  role: "professional" as const,
  gender: "female" as const,
  country: "ES" as const,
  dateOfBirth: "1990-05-17",
  specialty: "family_physician" as const,
  licenseNumber: "TEST-123",
  locale: "ca" as const,
  consents: { termsAcceptance: true as const, privacyPolicyAcknowledgement: true as const },
};
describe("Morpheo invitations: persistent boundaries and recovery", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const assignments = new RoleAssignmentsRepository(db);
  let app: NestFastifyApplication;
  let service: PlatformInvitationsService;
  let consent: ConsentService;
  let admin: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = module.get(PlatformInvitationsService);
    consent = module.get(ConsentService);
  });
  afterAll(async () => app.close());
  beforeEach(async () => {
    await resetTables();
    admin = await users.create({ email: "super@example.com" });
    const role = await new RolesRepository(db).findByKey("platform_super_admin");
    if (!role) throw new Error("missing reference role");
    await assignments.assign({ userId: admin, roleId: role.id, assignedBy: null });
  });
  const accept = (
    invitationId: string,
    email = input.email,
    request: typeof registration | undefined = registration,
  ) =>
    service.accept(
      {
        invitationId,
        email,
        providerUserId: "firebase-ana",
        ...(request ? { registration: request } : {}),
      },
      "test-platform-invite",
    );

  it("creates no account until consent-bearing acceptance, and never grants professional permissions", async () => {
    const invitation = await service.create(admin, input);
    expect(await users.findByEmail(input.email)).toBeNull();
    const account = await accept(invitation.id);
    expect((await users.findById(account.userId))?.status).toBe("active");
    expect(
      (await new IndividualProfilesRepository(db).findByUser({ userId: account.userId }))
        ?.firstName,
    ).toBe("Ana");
    expect(
      (await new ProfessionalProfilesRepository(db).findByUser({ userId: account.userId }))
        ?.verificationStatus,
    ).toBe("pending");
    expect(await assignments.listActiveForUser({ userId: account.userId })).toHaveLength(0);
    expect(
      (await consent.getStatus(account.userId)).purposes
        .filter((p) => p.consented)
        .map((p) => p.purposeKey)
        .sort(),
    ).toEqual(["privacy_policy_acknowledgement", "terms_acceptance"]);
    await expect(accept(invitation.id)).rejects.toMatchObject({ code: "INVITATION_ALREADY_USED" });
  });
  it("refuses every non-superadmin, mismatched address, and missing registration", async () => {
    const ordinary = await users.create({ email: "ordinary@example.com" });
    await expect(service.create(ordinary, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const invitation = await service.create(admin, input);
    await expect(accept(invitation.id, "other@example.com")).rejects.toMatchObject({
      code: "INVITATION_NOT_FOUND",
    });
    await expect(
      service.accept(
        { invitationId: invitation.id, email: input.email, providerUserId: "firebase-ana" },
        "test",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await users.findByEmail(input.email)).toBeNull();
  });
  it("rejects expired, revoked and replaced invitations and a suspended issuer", async () => {
    const old = await service.create(admin, input);
    const current = await service.create(admin, input);
    await expect(accept(old.id)).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    await db
      .update(platformInvitations)
      .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(platformInvitations.id, current.id));
    await expect(accept(current.id)).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    const revoked = await service.create(admin, input);
    await service.revoke(admin, revoked.id);
    await expect(accept(revoked.id)).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    const pending = await service.create(admin, input);
    await users.setStatus(admin, "suspended");
    await expect(accept(pending.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("recovers a consent failure without activating or duplicating an account", async () => {
    const invitation = await service.create(admin, input);
    const failure = vi.spyOn(consent, "record").mockRejectedValueOnce(new Error("unavailable"));
    await expect(accept(invitation.id)).rejects.toThrow("unavailable");
    failure.mockRestore();
    const prepared = await users.findByEmail(input.email);
    expect(prepared?.status).toBe("suspended");
    const account = await accept(invitation.id);
    expect(account.userId).toBe(prepared?.id);
    expect((await users.findById(account.userId))?.status).toBe("active");
  });
  it("accepts existing accounts without changing profile, locale, consents or roles", async () => {
    const userId = await users.create({ email: input.email, locale: "fr" });
    await users.linkIdentity({ userId, providerUserId: "firebase-ana" });
    const invitation = await service.create(admin, input);
    const account = await service.accept(
      { invitationId: invitation.id, email: input.email, providerUserId: "firebase-ana" },
      "test",
    );
    expect(account).toMatchObject({ userId, locale: "fr" });
    expect(await new IndividualProfilesRepository(db).findByUser({ userId })).toBeNull();
    expect((await consent.getStatus(userId)).purposes.every((p) => !p.consented)).toBe(true);
  });
  it("serializes concurrent accepts: one success and one account", async () => {
    const invitation = await service.create(admin, input);
    const results = await Promise.allSettled([accept(invitation.id), accept(invitation.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await users.findByEmail(input.email))?.status).toBe("active");
  });
  it("lists and revokes only for the authorized issuer, and refuses inactive targets and self-invitation", async () => {
    const ordinary = await users.create({ email: "ordinary@example.com" });
    await expect(service.list(ordinary)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.create(admin, { ...input, email: "super@example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const status of ["suspended", "deleted"] as const) {
      await users.setStatus(ordinary, status);
      await expect(
        service.create(admin, { ...input, email: "ordinary@example.com" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const invitation = await service.create(admin, input);
    expect((await service.list(admin)).invitations.map((row) => row.id)).toEqual([invitation.id]);
    await expect(service.revoke(ordinary, invitation.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await service.revoke(admin, invitation.id);
    await expect(service.revoke(admin, invitation.id)).rejects.toMatchObject({
      code: "INVITATION_NOT_FOUND",
    });
  });
  it("preserves a prepared account across replacement but forbids changing its branch or language", async () => {
    const invitation = await service.create(admin, input);
    const failure = vi.spyOn(consent, "record").mockRejectedValueOnce(new Error("offline"));
    await expect(accept(invitation.id)).rejects.toThrow("offline");
    failure.mockRestore();
    const prepared = await users.findByEmail(input.email);
    await expect(service.create(admin, { ...input, role: "adult" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(service.create(admin, { ...input, locale: "fr" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const replacement = await service.create(admin, input);
    await expect(accept(invitation.id)).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    await expect(
      service.accept(
        { invitationId: replacement.id, email: input.email, providerUserId: "firebase-ana" },
        "test",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await accept(replacement.id)).userId).toBe(prepared?.id);
  });
  it("refuses a mismatched registration branch and an email already linked to a different identity", async () => {
    const invitation = await service.create(admin, { ...input, role: "adult" });
    await expect(accept(invitation.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const existing = await users.create({ email: input.email });
    await users.linkIdentity({ userId: existing, providerUserId: "firebase-other" });
    await expect(
      service.accept(
        {
          invitationId: invitation.id,
          email: input.email,
          providerUserId: "firebase-ana",
          registration: { ...registration, role: "adult", ageYears: 36 },
        },
        "test",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rechecks status and address inside the repository and never activates after revocation", async () => {
    const repository = new PlatformInvitationsRepository(db);
    const invitation = await service.create(admin, input);
    const scope = {
      invitationId: invitation.id,
      email: input.email,
      providerUserId: "firebase-ana",
    };
    await expect(
      repository.prepare({ ...scope, email: "other@example.com" }, registration),
    ).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    await db
      .update(platformInvitations)
      .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(platformInvitations.id, invitation.id));
    await expect(repository.prepare(scope, registration)).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
    });
    const replacement = await service.create(admin, input);
    await expect(repository.prepare(scope, registration)).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    });
    const replacementScope = { ...scope, invitationId: replacement.id };
    const prepared = await repository.prepare(replacementScope, registration);
    await service.revoke(admin, replacement.id);
    await expect(repository.complete({ ...replacementScope, ...prepared })).rejects.toMatchObject({
      code: "INVITATION_ALREADY_USED",
    });
    expect((await users.findById(prepared.userId))?.status).toBe("suspended");
  });
  it("creates the adult branch without a professional profile and rejects a linked identity with another address", async () => {
    const repository = new PlatformInvitationsRepository(db);
    const invitation = await service.create(admin, { ...input, role: "adult" });
    const wrongUser = await users.create({ email: "wrong@example.com" });
    await users.linkIdentity({ userId: wrongUser, providerUserId: "wrong-provider" });
    const scope = {
      invitationId: invitation.id,
      email: input.email,
      providerUserId: "wrong-provider",
    };
    await expect(repository.prepare(scope, registration)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const account = await service.accept(
      {
        ...scope,
        providerUserId: "firebase-ana",
        registration: { ...registration, role: "adult", ageYears: 36 },
      },
      "test",
    );
    expect(
      await new ProfessionalProfilesRepository(db).findByUser({ userId: account.userId }),
    ).toBeNull();
  });
});
