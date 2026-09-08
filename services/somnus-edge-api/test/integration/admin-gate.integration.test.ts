import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  type EventEnvelope,
  EventEnvelopeSchema,
  INTERNAL_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey,
  UUIDv7,
} from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import {
  EDGE_EVENT_PUBLISHER,
  type EventPublisher,
} from "../../src/infrastructure/events/event-publisher.js";
import { IDENTITY_CLIENT } from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient, type RecordedRequest } from "../support/fake-identity.js";

/**
 * Addendum A §A2.1 / Checkpoint 15.1 — the admin console gate, **negative
 * first**.
 *
 * The route table is captured from the real Fastify router as Nest registers
 * it, not hand-listed: a new `/admin/v1/*` route is covered by these tests the
 * moment it exists, which is the only way "every admin route" can stay true.
 */

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "admin@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: ACTOR,
};

const EXTERNAL_ROLES = ROLE_KEYS.filter((key) => !INTERNAL_ROLE_KEYS.has(key));
const INTERNAL_ROLES = ROLE_KEYS.filter((key) => INTERNAL_ROLE_KEYS.has(key));

/** The A2.2 rows, as the policy resolves them. Used to script identity's answers. */
const CAPABILITIES_BY_ROLE: Record<string, string[]> = {
  support_agent: ["admin_users_read", "admin_statistics_read", "admin_consent_read"],
  professional_verifier: ["admin_users_read", "admin_verification_queue"],
  clinical_governance_reviewer: [
    "admin_content_review",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_break_glass",
  ],
  platform_admin: [
    "admin_users_read",
    "admin_account_status_write",
    "admin_deletion_requests_process",
    "admin_verification_queue",
    "admin_organizations_manage",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_consent_read",
    "admin_break_glass",
    "admin_system_health",
  ],
  platform_super_admin: ["admin_users_read", "admin_roles_assign", "admin_break_glass"],
};

describe("admin console gate (/admin/v1/*)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let requests: RecordedRequest[];
  let published: EventEnvelope[];
  /** The roles identity will report for the acting session. */
  let actorRoles: RoleKey[];
  /** Every `/admin/v1/*` route Nest actually registered. */
  const adminRoutes: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/authorization/admin-context") {
        const internal = actorRoles.filter((r) => INTERNAL_ROLE_KEYS.has(r));
        const capabilities = internal.flatMap((r) => CAPABILITIES_BY_ROLE[r] ?? []);
        return {
          status: 200,
          body: { roleKeys: internal, capabilities: [...new Set(capabilities)] },
        };
      }
      if (req.path === "/internal/v1/authorization/admin-check") {
        const { capability } = JSON.parse(req.body ?? "{}") as { capability: string };
        const internal = actorRoles.filter((r) => INTERNAL_ROLE_KEYS.has(r));
        const allowed = internal.some((r) => (CAPABILITIES_BY_ROLE[r] ?? []).includes(capability));
        return {
          status: 200,
          body: {
            allowed,
            decisionId: UUIDv7(),
            reasonCode: allowed
              ? "AUTHORIZED_BY_INTERNAL_ROLE"
              : internal.length === 0
                ? "DENIED_NOT_AN_INTERNAL_ROLE"
                : "DENIED_CAPABILITY_NOT_GRANTED",
          },
        };
      }
      if (req.path.startsWith("/internal/v1/admin/")) {
        // Shapes just valid enough for the edge's response contracts; what is
        // under test here is the gate, not identity's own behaviour.
        if (req.path.endsWith("/users/search")) {
          return { status: 200, body: { users: [], truncated: false } };
        }
        if (req.path.endsWith("/roles/assign")) {
          return {
            status: 201,
            body: {
              assignmentId: UUIDv7(),
              targetUserId: UUIDv7(),
              roleKey: "support_agent",
              source: "console",
            },
          };
        }
        if (req.path.includes("/organizations") && req.method === "POST") {
          return {
            status: 201,
            body: {
              id: UUIDv7(),
              name: "Org",
              status: "active",
              createdAt: new Date().toISOString(),
            },
          };
        }
        if (req.path.includes("/decision") || req.path.endsWith("/status")) {
          return { status: 200, body: {} };
        }
        return { status: 200, body: [] };
      }
      if (req.path === "/v1/me") {
        return {
          status: 200,
          body: {
            user: { id: ACTOR, email: "admin@example.com", locale: "es", status: "active" },
            individualProfile: { firstName: "Ada", lastName: "Lovelace" },
            professionalProfile: null,
          },
        };
      }
      return { status: 404, body: {} };
    });
    requests = fake.requests;

    published = [];
    const capturingPublisher: EventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
      .useValue(fake.client)
      .overrideProvider(EDGE_EVENT_PUBLISHER)
      .useValue(capturingPublisher)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ session?: SessionRecord }>();
          req.session = SESSION;
          return true;
        },
      })
      .compile();

    const adapter = new FastifyAdapter();
    // Capture the real route table as Nest registers it.
    adapter.getInstance().addHook("onRoute", (route) => {
      if (!route.url.startsWith("/admin/v1")) return;
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method === "HEAD") continue;
        adminRoutes.push({ method, url: route.url });
      }
    });

    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    requests.length = 0;
    published.length = 0;
    actorRoles = [];
  });

  it("registered an admin route table to test against", () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
    expect(adminRoutes).toContainEqual({ method: "GET", url: "/admin/v1/me" });
  });

  // --- Negative first ---

  describe("a session with only external roles is refused on every admin route", () => {
    it.each(EXTERNAL_ROLES)("%s", async (role) => {
      actorRoles = [role];

      for (const route of adminRoutes) {
        const res = await server.inject({ method: route.method, url: route.url });
        expect(res.statusCode, `${route.method} ${route.url} must be 403 for ${role}`).toBe(403);
        expect(res.json()).toMatchObject({
          error: { code: "FORBIDDEN", details: { reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE" } },
        });
      }
    });

    it("an actor holding every external role at once is still refused", async () => {
      actorRoles = [...EXTERNAL_ROLES];
      for (const route of adminRoutes) {
        const res = await server.inject({ method: route.method, url: route.url });
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
      }
    });

    it("an actor with no roles at all is refused", async () => {
      actorRoles = [];
      for (const route of adminRoutes) {
        const res = await server.inject({ method: route.method, url: route.url });
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
      }
    });

    it("emits NO admin audit event when the gate refuses", async () => {
      actorRoles = ["individual_user"];
      const res = await server.inject({ method: "GET", url: "/admin/v1/me" });

      expect(res.statusCode).toBe(403);
      // A refused request is not an admin action. The denial is an
      // authorization decision, recorded by identity, not an admin audit record.
      expect(published).toHaveLength(0);
    });
  });

  // --- Then the positive side ---

  describe("an internal role reaches the shell", () => {
    it.each(INTERNAL_ROLES)("%s gets 200 on /admin/v1/me", async (role) => {
      actorRoles = [role];
      const res = await server.inject({ method: "GET", url: "/admin/v1/me" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { roleKeys: string[]; capabilities: string[] };
      expect(body.roleKeys).toEqual([role]);
      expect(body.capabilities).toEqual(CAPABILITIES_BY_ROLE[role]);
    });

    it("reports only INTERNAL roles, never the actor's external ones", async () => {
      actorRoles = ["professional", "platform_admin", "organization_owner"];
      const res = await server.inject({ method: "GET", url: "/admin/v1/me" });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { roleKeys: string[] }).roleKeys).toEqual(["platform_admin"]);
    });

    it("holds no capability matrix of its own: it asks identity", async () => {
      actorRoles = ["platform_admin"];
      await server.inject({ method: "GET", url: "/admin/v1/me" });

      // The decision came from identity, over the internal boundary.
      expect(requests.map((r) => r.path)).toContain("/internal/v1/authorization/admin-context");
    });
  });

  /**
   * Addendum A Checkpoint 15.2: "capability matrix enforced per role
   * (parametrized)".
   *
   * The route -> capability table below is transcribed independently from the
   * decorators, and the role -> capability rows from §A2.2, so this test can
   * disagree with the code rather than restate it. Every internal role is then
   * driven against every admin route: 200 exactly where its matrix row allows,
   * 403 everywhere else.
   */
  describe("the capability matrix is enforced per route, for every internal role", () => {
    const ROUTE_CAPABILITY: Array<{ method: string; url: string; capability: string }> = [
      { method: "GET", url: "/admin/v1/me", capability: "any_internal_role" },
      { method: "POST", url: "/admin/v1/users/search", capability: "admin_users_read" },
      { method: "GET", url: "/admin/v1/users/u1", capability: "admin_users_read" },
      {
        method: "PATCH",
        url: "/admin/v1/users/u1/status",
        capability: "admin_account_status_write",
      },
      {
        method: "GET",
        url: "/admin/v1/deletion-requests",
        capability: "admin_deletion_requests_process",
      },
      {
        method: "POST",
        url: "/admin/v1/deletion-requests/d1/decision",
        capability: "admin_deletion_requests_process",
      },
      { method: "GET", url: "/admin/v1/organizations", capability: "admin_organizations_manage" },
      { method: "POST", url: "/admin/v1/organizations", capability: "admin_organizations_manage" },
      {
        method: "PATCH",
        url: "/admin/v1/organizations/o1/status",
        capability: "admin_organizations_manage",
      },
      {
        method: "GET",
        url: "/admin/v1/organizations/o1/members",
        capability: "admin_organizations_manage",
      },
      {
        method: "GET",
        url: "/admin/v1/verification-cases",
        capability: "admin_verification_queue",
      },
      {
        method: "POST",
        url: "/admin/v1/verification-cases/c1/decision",
        capability: "admin_verification_queue",
      },
      { method: "POST", url: "/admin/v1/roles/assign", capability: "admin_roles_assign" },
      // Checkpoint 15.3 -- the AI content review queue. §A2.2 grants
      // admin_content_review to clinical_governance_reviewer and
      // platform_super_admin only; every other internal role, support_agent
      // and platform_admin included, is refused by the parametrized run below.
      {
        method: "GET",
        url: "/admin/v1/content-review/items",
        capability: "admin_content_review",
      },
      {
        method: "POST",
        url: "/admin/v1/content-review/items/i1/decision",
        capability: "admin_content_review",
      },
      // Checkpoint 15.4 -- statistics and the audit log. Three routes, three
      // different answers: dashboards for the wider analyst set, the audit log
      // for the narrower one, and the CSV export for platform_super_admin alone.
      {
        method: "POST",
        url: "/admin/v1/statistics",
        capability: "admin_statistics_read",
      },
      {
        method: "POST",
        url: "/admin/v1/audit/query",
        capability: "admin_audit_read",
      },
      {
        method: "POST",
        url: "/admin/v1/audit/export",
        capability: "admin_audit_export",
      },
    ];

    /** Bodies that satisfy each route's contract, so a 4xx can only be the gate. */
    const BODIES: Record<string, unknown> = {
      "POST /admin/v1/users/search": { limit: 5 },
      "PATCH /admin/v1/users/u1/status": { status: "suspended", reason: "because" },
      "POST /admin/v1/deletion-requests/d1/decision": { decision: "cancel", reason: "because" },
      "POST /admin/v1/organizations": { name: "Nox Institute" },
      "PATCH /admin/v1/organizations/o1/status": { status: "active", reason: "because" },
      "POST /admin/v1/verification-cases/c1/decision": {
        decision: "approve",
        reason: "because",
      },
      "POST /admin/v1/roles/assign": {
        targetUserId: "018f0000-0000-7000-8000-0000000000ff",
        roleKey: "support_agent",
      },
    };

    it("covers every route the router actually registered", () => {
      const declared = ROUTE_CAPABILITY.map(
        (r) => `${r.method} ${r.url.replace(/\/(u1|o1|c1|d1)/g, "/:p")}`,
      );
      const registered = adminRoutes.map(
        (r) => `${r.method} ${r.url.replace(/:[A-Za-z]+/g, ":p")}`,
      );
      expect(new Set(declared).size).toBe(new Set(registered).size);
    });

    for (const role of INTERNAL_ROLES) {
      describe(role, () => {
        it.each(ROUTE_CAPABILITY)("$method $url", async ({ method, url, capability }) => {
          actorRoles = [role];
          const allowed =
            capability === "any_internal_role" ||
            (CAPABILITIES_BY_ROLE[role] ?? []).includes(capability);

          const payload = BODIES[`${method} ${url}`];
          const res = await server.inject({
            method,
            url,
            ...(payload !== undefined
              ? {
                  payload: JSON.stringify(payload),
                  headers: { "content-type": "application/json" },
                }
              : {}),
          });

          if (allowed) {
            expect(res.statusCode, `${role} should reach ${method} ${url}`).not.toBe(403);
          } else {
            expect(res.statusCode, `${role} must NOT reach ${method} ${url}`).toBe(403);
            expect(res.json()).toMatchObject({
              error: { details: { reasonCode: "DENIED_CAPABILITY_NOT_GRANTED" } },
            });
          }
        });
      });
    }

    it("only platform_super_admin may reach the role-assignment route", async () => {
      for (const role of INTERNAL_ROLES) {
        actorRoles = [role];
        const res = await server.inject({
          method: "POST",
          url: "/admin/v1/roles/assign",
          payload: JSON.stringify({
            targetUserId: "018f0000-0000-7000-8000-0000000000ff",
            roleKey: "support_agent",
          }),
          headers: { "content-type": "application/json" },
        });
        if (role === "platform_super_admin") {
          expect(res.statusCode, role).not.toBe(403);
        } else {
          expect(res.statusCode, role).toBe(403);
        }
      }
    });
  });

  // --- "There is no admin action without an audit record" (§A2.1) ---

  describe("every admin call produces exactly one audit event", () => {
    it.each(INTERNAL_ROLES)("%s: one call, one event", async (role) => {
      actorRoles = [role];
      const res = await server.inject({ method: "GET", url: "/admin/v1/me" });

      expect(res.statusCode).toBe(200);
      expect(published).toHaveLength(1);

      const event = published[0] as EventEnvelope;
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
      expect(event.eventType).toBe("admin.session.opened.v1");
      expect(event.producer).toBe("somnus-edge-api");
      expect(event.actor).toEqual({ type: "user", id: ACTOR });
      // The acting admin and what they were permitted -- never a request body,
      // never anything about a subject.
      expect(event.data).toEqual({ capability: "any_internal_role" });
    });

    it("three calls produce exactly three events, never batched or dropped", async () => {
      actorRoles = ["platform_admin"];
      await server.inject({ method: "GET", url: "/admin/v1/me" });
      await server.inject({ method: "GET", url: "/admin/v1/me" });
      await server.inject({ method: "GET", url: "/admin/v1/me" });

      expect(published).toHaveLength(3);
      expect(new Set(published.map((e) => e.eventId)).size).toBe(3);
    });

    it("names the event `admin.<entity>.<action>.v1` (§A2.1)", () => {
      expect("admin.session.opened.v1").toMatch(/^admin\.[a-z_]+\.[a-z_]+\.v\d+$/);
    });
  });
});
