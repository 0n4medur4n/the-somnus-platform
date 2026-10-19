import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { EventEnvelope, RoleKey, StaffInvitation, UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/common/decorators/current-actor.decorator.js";
import { RoleAssignmentsRepository } from "../../src/infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../src/infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { staffInvitations } from "../../src/infrastructure/db/schema/index.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../src/infrastructure/events/event-publisher.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

type JsonResponse = { statusCode: number; body: unknown };

/**
 * Staff invitations (owner decision 2026-10-18): the admin invites, and the
 * account exists only once the invited person signs in and accepts.
 */
describe("staff invitations", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const db = getTestDb();
  const users = new UsersRepository(db);
  const roles = new RolesRepository(db);
  const roleAssignments = new RoleAssignmentsRepository(db);
  const published: EventEnvelope[] = [];
  const capturingPublisher: EventPublisher = {
    publish: async (event) => {
      published.push(event);
    },
  };

  async function inject(
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
    return { statusCode: res.statusCode, body: res.body.length > 0 ? res.json() : undefined };
  }

  async function seedRole(key: RoleKey): Promise<UUIDv7> {
    let role = await roles.findByKey(key);
    if (!role) {
      await roles.seedRole({ key, name: key, scope: "platform", isInternal: true });
      role = await roles.findByKey(key);
    }
    if (!role) throw new Error(`failed to seed ${key}`);
    return role.id;
  }

  async function heldRoleKeys(userId: string): Promise<string[]> {
    const res = await inject("POST", "/internal/v1/authorization/admin-context", {
      payload: { actorUserId: userId },
    });
    return (res.body as { roleKeys: string[] }).roleKeys;
  }

  let adminId: UUIDv7;

  const INVITE = {
    firstName: "Ana",
    lastName: "García López",
    email: "Ana.Garcia@Example.com",
    roleKey: "support_agent",
    locale: "es",
  } as const;

  const invite = (payload: Record<string, unknown> = INVITE, actorId: string = adminId) =>
    inject("POST", "/internal/v1/admin/staff-invitations", { actorId, payload });

  const accept = (providerUserId: string, email: string) =>
    inject("POST", "/internal/v1/staff-invitations/accept", { payload: { providerUserId, email } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    await seedRole("support_agent");
    await seedRole("platform_admin");
    const superAdminRole = await seedRole("platform_super_admin");
    adminId = await users.create({ email: "admin@thesomnus.com" });
    await roleAssignments.assign({ userId: adminId, roleId: superAdminRole, assignedBy: null });
  });

  it("creates a pending invitation with the name, a normalised address and the role -- and NO account", async () => {
    const res = await invite();
    expect(res.statusCode).toBe(201);
    const invitation = res.body as StaffInvitation;
    expect(invitation).toMatchObject({
      firstName: "Ana",
      lastName: "García López",
      email: "ana.garcia@example.com",
      roleKey: "support_agent",
      status: "pending",
      invitedBy: adminId,
      acceptedAt: null,
    });
    expect(await users.findByEmail("ana.garcia@example.com")).toBeNull();

    const list = await inject("GET", "/internal/v1/admin/staff-invitations", { actorId: adminId });
    expect((list.body as { invitations: StaffInvitation[] }).invitations).toHaveLength(1);
  });

  it("refuses an external role and an admin inviting their own address", async () => {
    expect((await invite({ ...INVITE, roleKey: "professional" })).statusCode).toBe(400);
    expect((await invite({ ...INVITE, roleKey: "individual_user" })).statusCode).toBe(400);
    expect((await invite({ ...INVITE, email: "ADMIN@thesomnus.com" })).statusCode).toBe(403);
  });

  it("inviting the same address again replaces the pending invitation", async () => {
    const first = (await invite()).body as StaffInvitation;
    const second = (await invite({ ...INVITE, roleKey: "platform_admin" })).body as StaffInvitation;
    const list = await inject("GET", "/internal/v1/admin/staff-invitations", { actorId: adminId });
    const rows = (list.body as { invitations: StaffInvitation[] }).invitations;
    expect(rows.find((r) => r.id === first.id)?.status).toBe("revoked");
    expect(rows.find((r) => r.id === second.id)?.status).toBe("pending");
  });

  it("the invited address sees what it was invited as; any other address sees nothing", async () => {
    await invite();
    const mine = await inject("POST", "/internal/v1/staff-invitations/pending", {
      payload: { email: "ana.garcia@example.com" },
    });
    expect(mine.body).toEqual({
      invitation: { firstName: "Ana", roleKey: "support_agent", expiresAt: expect.any(String) },
    });
    const other = await inject("POST", "/internal/v1/staff-invitations/pending", {
      payload: { email: "someone@example.com" },
    });
    expect(other.body).toEqual({ invitation: null });
  });

  it("accepting creates the account, links the sign-in, records the privacy receipt and grants the role", async () => {
    const invitation = (await invite()).body as StaffInvitation;
    const res = await accept("firebase-ana", "ana.garcia@example.com");
    expect(res.statusCode).toBe(200);
    const { userId } = res.body as { userId: string };

    expect((await users.findByProviderUserId("firebase-ana"))?.userId).toBe(userId);
    expect(await heldRoleKeys(userId)).toEqual(["support_agent"]);

    // Granted on behalf of the admin who invited -- never as a self-grant.
    const held = await roleAssignments.listActiveForUser({ userId: userId as UUIDv7 });
    expect(held[0]?.assignedBy).toBe(adminId);

    const consents = await inject("GET", "/v1/consents/current", { actorId: userId });
    const purposes = (consents.body as { purposes: { purposeKey: string; consented: boolean }[] })
      .purposes;
    expect(purposes.find((p) => p.purposeKey === "privacy_policy_acknowledgement")?.consented).toBe(
      true,
    );

    const [row] = await db
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.id, invitation.id));
    expect(row?.status).toBe("accepted");
    expect(row?.acceptedUserId).toBe(userId);

    const accepted = published.filter(
      (e) => e.eventType === "identity.staff_invitation.accepted.v1",
    );
    expect(accepted).toHaveLength(1);
    // The event carries ids only: no name and no address.
    expect(JSON.stringify(accepted[0])).not.toContain("ana.garcia");
    expect(JSON.stringify(accepted[0])).not.toContain("García");
  });

  it("an invitation is used once: a second accept is refused", async () => {
    await invite();
    expect((await accept("firebase-ana", "ana.garcia@example.com")).statusCode).toBe(200);
    expect((await accept("firebase-ana", "ana.garcia@example.com")).statusCode).toBe(404);
  });

  it("an existing account with that address gets the role on the account it already controls", async () => {
    const existing = await users.create({ email: "ana.garcia@example.com" });
    await users.linkIdentity({ userId: existing, providerUserId: "firebase-ana" });
    await invite();
    const res = await accept("firebase-ana", "ana.garcia@example.com");
    expect(res.statusCode).toBe(200);
    expect((res.body as { userId: string }).userId).toBe(existing);
    expect(await heldRoleKeys(existing)).toEqual(["support_agent"]);
  });

  it("refuses an address that already has an account under a DIFFERENT sign-in", async () => {
    const existing = await users.create({ email: "ana.garcia@example.com" });
    await users.linkIdentity({ userId: existing, providerUserId: "firebase-original" });
    await invite();
    expect((await accept("firebase-someone-else", "ana.garcia@example.com")).statusCode).toBe(409);
    expect(await heldRoleKeys(existing)).toEqual([]);
  });

  it("an address with no invitation, a revoked one or an expired one cannot accept", async () => {
    expect((await accept("firebase-x", "nobody@example.com")).statusCode).toBe(404);

    const revoked = (await invite()).body as StaffInvitation;
    const res = await inject("POST", `/internal/v1/admin/staff-invitations/${revoked.id}/revoke`, {
      actorId: adminId,
    });
    expect((res.body as StaffInvitation).status).toBe("revoked");
    expect((await accept("firebase-ana", "ana.garcia@example.com")).statusCode).toBe(404);

    const expiring = (await invite()).body as StaffInvitation;
    await db
      .update(staffInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(staffInvitations.id, expiring.id));
    expect((await accept("firebase-ana", "ana.garcia@example.com")).statusCode).toBe(404);
    const list = await inject("GET", "/internal/v1/admin/staff-invitations", { actorId: adminId });
    const rows = (list.body as { invitations: StaffInvitation[] }).invitations;
    expect(rows.find((r) => r.id === expiring.id)?.status).toBe("expired");
    expect(await users.findByEmail("ana.garcia@example.com")).toBeNull();
  });
});
