import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  ADMIN_CAPABILITIES,
  type EventEnvelope,
  EventEnvelopeSchema,
  INTERNAL_ROLE_KEYS,
  isKnownEventType,
  ROLE_KEYS,
  type RoleKey,
  UUIDv7,
} from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { registerRawBodyParsers } from "../../src/bootstrap/harden.js";
import {
  EDGE_EVENT_PUBLISHER,
  type EventPublisher,
} from "../../src/infrastructure/events/event-publisher.js";
import {
  IDENTITY_CLIENT,
  MORPHEO_CLIENT,
  REPORT_CLIENT,
  WORKER_CLIENT,
} from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { AdminDriveController } from "../../src/modules/admin/admin-drive.controller.js";
import {
  ADMIN_ROUTE_KEY,
  type AdminRouteMeta,
} from "../../src/modules/admin/admin-route.decorator.js";
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

/** Valid opaque ids for the Drive's path parameters, which edge-api validates. */
const DRIVE_SHARE = "018f0000-0000-7000-8000-00000000d501";
const DRIVE_NODE = "018f0000-0000-7000-8000-00000000d502";
const DRIVE_MEMBER = "018f0000-0000-7000-8000-00000000d503";
const DRIVE_NODE_URL = "/admin/v1/drive/shares/s1/nodes/n1";

/** The staff Drive's routes, transcribed independently of the controller. */
const DRIVE_ROUTES: Array<{ method: string; url: string }> = [
  { method: "GET", url: "/admin/v1/drive/account" },
  { method: "POST", url: "/admin/v1/drive/account" },
  { method: "POST", url: "/admin/v1/drive/account/rewrap" },
  { method: "POST", url: "/admin/v1/drive/account/state" },
  { method: "POST", url: "/admin/v1/drive/account/reset" },
  { method: "GET", url: "/admin/v1/drive/directory" },
  { method: "GET", url: "/admin/v1/drive/shares" },
  { method: "POST", url: "/admin/v1/drive/shares" },
  { method: "GET", url: "/admin/v1/drive/shares/s1" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/purge" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/access" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/accept" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/access/m1/role" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/access/m1/remove" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/folders" },
  { method: "POST", url: "/admin/v1/drive/shares/s1/uploads" },
  { method: "PUT", url: `${DRIVE_NODE_URL}/revisions/1/blocks/0` },
  { method: "POST", url: `${DRIVE_NODE_URL}/revisions/1/commit` },
  { method: "GET", url: `${DRIVE_NODE_URL}/revisions/1/blocks/0` },
  { method: "POST", url: `${DRIVE_NODE_URL}/rename` },
  { method: "POST", url: `${DRIVE_NODE_URL}/move` },
  { method: "POST", url: `${DRIVE_NODE_URL}/trash` },
  { method: "POST", url: `${DRIVE_NODE_URL}/restore` },
  { method: "POST", url: `${DRIVE_NODE_URL}/purge` },
];

/** A Drive route with real ids, for tests that need the request past validation. */
function driveUrl(url: string): string {
  return url
    .replace("/s1", `/${DRIVE_SHARE}`)
    .replace("/n1", `/${DRIVE_NODE}`)
    .replace("/m1", `/${DRIVE_MEMBER}`);
}

/** The A2.2 rows, as the policy resolves them. Used to script identity's answers. */
const CAPABILITIES_BY_ROLE: Record<string, string[]> = {
  // `admin_drive` closes every internal row: the staff Drive (ADR 0019) is open
  // to all internal staff, and folder membership decides the rest.
  support_agent: ["admin_users_read", "admin_statistics_read", "admin_consent_read", "admin_drive"],
  professional_verifier: ["admin_users_read", "admin_verification_queue", "admin_drive"],
  clinical_governance_reviewer: [
    "admin_content_review",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_break_glass",
    "admin_drive",
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
    "admin_drive",
  ],
  platform_super_admin: [
    "admin_users_read",
    "admin_roles_assign",
    "admin_break_glass",
    // Addendum B §B6 item 4: corpus management is this role's alone. There is
    // no separate clinical-review gate on it, which is exactly why no other role
    // may reach it.
    "admin_corpus_manage",
    "admin_drive",
  ],
};

describe("admin console gate (/admin/v1/*)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let requests: RecordedRequest[];
  let published: EventEnvelope[];
  const workerCalls: Array<{ method: string; path: string; body: unknown }> = [];
  let driveHeaders: Array<Record<string, string>> = [];
  /** What the worker stub answers to a GET, when a test needs a valid Drive body. */
  let workerBlockAnswer: { status: number; body: unknown } | null = null;
  /** The roles identity will report for the acting session. */
  let actorRoles: RoleKey[];
  /**
   * Capabilities to report regardless of role. Used only by the "every
   * capability but this one" test, which has to describe an actor the A2.2
   * matrix cannot produce.
   */
  let capabilityOverride: string[] | null;
  /** Every `/admin/v1/*` route Nest actually registered. */
  const adminRoutes: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/authorization/admin-context") {
        const internal = actorRoles.filter((r) => INTERNAL_ROLE_KEYS.has(r));
        const capabilities =
          capabilityOverride ?? internal.flatMap((r) => CAPABILITIES_BY_ROLE[r] ?? []);
        return {
          status: 200,
          body: { roleKeys: internal, capabilities: [...new Set(capabilities)] },
        };
      }
      if (req.path === "/internal/v1/authorization/admin-check") {
        const { capability } = JSON.parse(req.body ?? "{}") as { capability: string };
        const internal = actorRoles.filter((r) => INTERNAL_ROLE_KEYS.has(r));
        const allowed =
          capabilityOverride !== null
            ? internal.length > 0 && capabilityOverride.includes(capability)
            : internal.some((r) => (CAPABILITIES_BY_ROLE[r] ?? []).includes(capability));
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
        if (req.path.includes("/staff-invitations")) {
          const invitation = {
            id: UUIDv7(),
            firstName: "Ana",
            lastName: "García",
            email: "ana@example.com",
            roleKey: "support_agent",
            locale: "es",
            status: "pending",
            invitedBy: ACTOR,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            acceptedAt: null,
          };
          return req.method === "GET"
            ? { status: 200, body: { invitations: [invitation] } }
            : { status: 201, body: invitation };
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
            account: {
              registrationRole: "adult",
              internalRoles: ["platform_admin"],
              organizations: [],
            },
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

    // Break-glass reaches morpheo for the clinical records (§7). The gate is
    // what is under test here, so morpheo answers with a valid empty result and
    // any 4xx can only have come from the guard.
    const morpheoStub = {
      get: async () => ({ status: 200, body: {} }),
      post: async () => ({ status: 200, body: { snapshots: [] } }),
    };

    // The review queue (15.3) and the reference corpus (16.3) both live behind
    // the report service. Stubbed for the same reason morpheo is: the gate is
    // what is under test, so a 4xx here can only have come from the guard.
    const reportStub = {
      get: async () => ({ status: 200, body: {} }),
      post: async () => ({ status: 200, body: {} }),
    };

    // The statistics, audit viewer and staff Drive (ADR 0019) live behind the
    // worker. Stubbed like the others, and recording what reached it, so the
    // Drive's raw block body and actor headers can be checked on their way.
    const workerStub = {
      get: async (path: string) => {
        workerCalls.push({ method: "GET", path, body: undefined });
        return workerBlockAnswer ?? { status: 200, body: {} };
      },
      post: async (path: string, options: { body?: unknown; headers?: Record<string, string> }) => {
        workerCalls.push({ method: "POST", path, body: options.body });
        driveHeaders.push(options.headers ?? {});
        return { status: 200, body: {} };
      },
      put: async (path: string, options: { body?: unknown }) => {
        workerCalls.push({ method: "PUT", path, body: options.body });
        return { status: 204, body: undefined };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
      .useValue(fake.client)
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(morpheoStub)
      .overrideProvider(REPORT_CLIENT)
      .useValue(reportStub)
      .overrideProvider(WORKER_CLIENT)
      .useValue(workerStub)
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
    // The raw-body parsers production registers in applyHardening: the Drive's
    // block upload is an octet-stream body, and must parse here as it does there.
    registerRawBodyParsers(server);
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    requests.length = 0;
    published.length = 0;
    workerCalls.length = 0;
    driveHeaders = [];
    actorRoles = [];
    capabilityOverride = null;
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
      // The console dashboard's account figures: counts only.
      { method: "GET", url: "/admin/v1/users/overview", capability: "admin_users_read" },
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
      // Staff invitations (owner decision 2026-10-18): accepting one grants an
      // internal role, so they sit behind the same capability as granting it.
      { method: "GET", url: "/admin/v1/staff-invitations", capability: "admin_roles_assign" },
      { method: "POST", url: "/admin/v1/staff-invitations", capability: "admin_roles_assign" },
      {
        method: "POST",
        url: "/admin/v1/staff-invitations/s1/revoke",
        capability: "admin_roles_assign",
      },
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
      // Checkpoint 15.5 -- break-glass. §A2.2 grants admin_break_glass to
      // clinical_governance_reviewer, platform_admin and platform_super_admin;
      // support_agent and professional_verifier are refused by the parametrized
      // run below, along with every external role by the sweep above.
      {
        method: "POST",
        url: "/admin/v1/break-glass/reveal",
        capability: "admin_break_glass",
      },
      // Addendum B Checkpoint 16.3 -- reference-corpus management. §B6 item 4
      // gives admin_corpus_manage to platform_super_admin alone, so the
      // parametrized run below refuses clinical_governance_reviewer and
      // platform_admin on every one of these, reads included.
      {
        method: "POST",
        url: "/admin/v1/corpus/documents/search",
        capability: "admin_corpus_manage",
      },
      {
        method: "GET",
        url: "/admin/v1/corpus/documents/doc1",
        capability: "admin_corpus_manage",
      },
      {
        method: "POST",
        url: "/admin/v1/corpus/documents",
        capability: "admin_corpus_manage",
      },
      {
        method: "POST",
        url: "/admin/v1/corpus/documents/doc1/edit",
        capability: "admin_corpus_manage",
      },
      {
        method: "POST",
        url: "/admin/v1/corpus/documents/doc1/publish",
        capability: "admin_corpus_manage",
      },
      {
        method: "POST",
        url: "/admin/v1/corpus/documents/doc1/retire",
        capability: "admin_corpus_manage",
      },
      {
        method: "GET",
        url: "/admin/v1/corpus/sources",
        capability: "admin_corpus_manage",
      },
      // The staff Drive (owner decision 2026-10-17, ADR 0019). Every internal
      // role holds admin_drive, so the parametrized run below lets each of them
      // through, and the external-role sweep above refuses every one of these.
      ...DRIVE_ROUTES.map((route) => ({ ...route, capability: "admin_drive" })),
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
      "POST /admin/v1/staff-invitations": {
        firstName: "Ana",
        lastName: "García",
        email: "ana@example.com",
        roleKey: "support_agent",
      },
      "POST /admin/v1/break-glass/reveal": {
        subjectUserId: "018f0000-0000-7000-8000-0000000000fe",
        category: "safety",
        justification: "Safeguarding escalation raised by the on-call clinician this morning.",
      },
      "POST /admin/v1/corpus/documents/search": { limit: 5 },
      "POST /admin/v1/corpus/documents": {
        title: "Higiene del sueño",
        citation: "The Somnus (2026).",
        sourceType: "guideline",
        locale: "es",
        scopes: [{ scopeType: "module", scopeKey: "INS" }],
      },
      "POST /admin/v1/corpus/documents/doc1/edit": { title: "Higiene del sueño (rev.)" },
      "POST /admin/v1/corpus/documents/doc1/publish": { changelog: "Alta de la guía." },
      "POST /admin/v1/corpus/documents/doc1/retire": {
        reason: "Sustituida por la edición de 2027.",
        changelog: "Retirada.",
      },
    };

    it("covers every route the router actually registered", () => {
      const declared = ROUTE_CAPABILITY.map(
        (r) => `${r.method} ${r.url.replace(/\/(u1|o1|c1|d1|doc1|s1|n1|m1|\d+)(?=\/|$)/g, "/:p")}`,
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

    /**
     * Addendum B Checkpoint 16.3: "an actor with all capabilities but this one is
     * refused".
     *
     * The parametrized run above shows that no OTHER role reaches the corpus, but
     * each of those roles is missing several capabilities at once, so it cannot
     * show WHICH absence did the refusing. This describes an actor holding every
     * admin capability the platform defines except `admin_corpus_manage` -- and
     * still refused on all seven routes.
     */
    it("an actor holding every capability but admin_corpus_manage is refused", async () => {
      actorRoles = ["platform_super_admin"];
      capabilityOverride = ADMIN_CAPABILITIES.filter((c) => c !== "admin_corpus_manage");
      expect(capabilityOverride).not.toContain("admin_corpus_manage");
      expect(capabilityOverride.length).toBe(ADMIN_CAPABILITIES.length - 1);

      const corpusRoutes = ROUTE_CAPABILITY.filter((r) => r.capability === "admin_corpus_manage");
      expect(corpusRoutes.length).toBeGreaterThan(0);

      for (const route of corpusRoutes) {
        const payload = BODIES[`${route.method} ${route.url}`];
        const res = await server.inject({
          method: route.method,
          url: route.url,
          ...(payload !== undefined
            ? { payload: JSON.stringify(payload), headers: { "content-type": "application/json" } }
            : {}),
        });
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
        expect(res.json()).toMatchObject({
          error: { details: { reasonCode: "DENIED_CAPABILITY_NOT_GRANTED" } },
        });
      }

      // The same actor, given that one capability back, gets through -- so what
      // refused them was the missing capability and nothing else.
      capabilityOverride = [...ADMIN_CAPABILITIES];
      const allowed = await server.inject({ method: "GET", url: "/admin/v1/corpus/sources" });
      expect(allowed.statusCode).not.toBe(403);
    });

    /**
     * §B3: append and retire, never delete. Asserted against the route table
     * Fastify actually registered, so it stays true for routes added later.
     */
    it("exposes a retire route and no delete route at all", () => {
      const corpus = adminRoutes.filter((r) => r.url.startsWith("/admin/v1/corpus"));
      expect(corpus.length).toBeGreaterThan(0);
      expect(corpus.some((r) => r.url.endsWith("/retire"))).toBe(true);

      for (const route of corpus) {
        expect(route.method, `${route.method} ${route.url}`).not.toBe("DELETE");
        expect(route.url.toLowerCase()).not.toContain("delete");
      }
    });

    it("cannot be asked to delete a corpus document", async () => {
      actorRoles = ["platform_super_admin"];
      const res = await server.inject({ method: "DELETE", url: "/admin/v1/corpus/documents/doc1" });
      // Not hidden by the UI, not refused by the guard: not routed at all.
      expect(res.statusCode).toBe(404);
    });

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

  // --- The staff Drive (owner decision 2026-10-17, ADR 0019) ---

  describe("the staff Drive", () => {
    it("an actor holding every capability but admin_drive is refused on every Drive route", async () => {
      actorRoles = ["platform_super_admin"];
      capabilityOverride = ADMIN_CAPABILITIES.filter((c) => c !== "admin_drive");
      for (const route of DRIVE_ROUTES) {
        const res = await server.inject({ method: route.method, url: driveUrl(route.url) });
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
        expect(res.json()).toMatchObject({
          error: { details: { reasonCode: "DENIED_CAPABILITY_NOT_GRANTED" } },
        });
      }
      expect(workerCalls).toHaveLength(0);
    });

    it("every Drive read emits one registered audit event", async () => {
      actorRoles = ["support_agent"];
      for (const route of DRIVE_ROUTES.filter((r) => r.method === "GET")) {
        published.length = 0;
        const res = await server.inject({ method: route.method, url: driveUrl(route.url) });
        expect(res.statusCode, route.url).not.toBe(403);
        expect(published, route.url).toHaveLength(res.statusCode < 400 ? 1 : 0);
      }
      for (const route of DRIVE_ROUTES) {
        expect(route.url.startsWith("/admin/v1/drive/")).toBe(true);
      }
    });

    it("every Drive handler declares admin_drive and a registered event type", () => {
      const prototype = AdminDriveController.prototype as unknown as Record<string, unknown>;
      const metas = Object.getOwnPropertyNames(prototype)
        .map((name) => Reflect.getMetadata(ADMIN_ROUTE_KEY, prototype[name] as object))
        .filter((meta): meta is AdminRouteMeta => meta !== undefined);
      expect(metas).toHaveLength(DRIVE_ROUTES.length);
      expect(new Set(metas.map((m) => m.eventType)).size).toBe(DRIVE_ROUTES.length);
      for (const meta of metas) {
        expect(meta.capability).toBe("admin_drive");
        expect(isKnownEventType(meta.eventType), meta.eventType).toBe(true);
        expect(meta.eventType).toMatch(/^admin\.drive_[a-z_]+\.[a-z_]+\.v1$/);
      }
    });

    it("records the folder or node as the audit subject, never anything about content", async () => {
      actorRoles = ["professional_verifier"];
      workerBlockAnswer = { status: 200, body: { data: "AAEC" } };
      const res = await server.inject({
        method: "GET",
        url: driveUrl(`${DRIVE_NODE_URL}/revisions/1/blocks/0`),
      });
      workerBlockAnswer = null;
      expect(res.statusCode).toBe(200);
      const event = published[0] as EventEnvelope;
      expect(event.subject).toEqual({ type: "drive_node", id: DRIVE_NODE });
      expect(event.data).toEqual({
        capability: "admin_drive",
        shareId: DRIVE_SHARE,
        revision: 1,
        blockIndex: 0,
      });
    });

    it("forwards a raw block to the worker as the same bytes, base64", async () => {
      actorRoles = ["platform_admin"];
      const bytes = Buffer.from([0, 255, 1, 254, 2, 253]);
      const res = await server.inject({
        method: "PUT",
        url: driveUrl(`${DRIVE_NODE_URL}/revisions/1/blocks/0`),
        payload: bytes,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(res.statusCode).toBe(204);
      expect(workerCalls).toEqual([
        {
          method: "PUT",
          path: `/internal/v1/drive/shares/${DRIVE_SHARE}/nodes/${DRIVE_NODE}/revisions/1/blocks/0`,
          body: { data: bytes.toString("base64") },
        },
      ]);
    });

    it("refuses a block larger than one encrypted block before it reaches the worker", async () => {
      actorRoles = ["platform_admin"];
      const res = await server.inject({
        method: "PUT",
        url: driveUrl(`${DRIVE_NODE_URL}/revisions/1/blocks/0`),
        payload: Buffer.alloc(512 * 1024 + 29),
        headers: { "content-type": "application/octet-stream" },
      });
      expect(res.statusCode).toBe(413);
      expect(workerCalls).toHaveLength(0);
    });

    it("refuses malformed path ids before they are spliced into an internal URL", async () => {
      actorRoles = ["platform_admin"];
      const cases: Array<{ method: "GET" | "POST"; url: string }> = [
        { method: "GET", url: "/admin/v1/drive/shares/..%2F..%2Faccount" },
        { method: "POST", url: `/admin/v1/drive/shares/${DRIVE_SHARE}/nodes/not-an-id/trash` },
        { method: "GET", url: driveUrl(`${DRIVE_NODE_URL}/revisions/1/blocks/40`) },
        { method: "GET", url: driveUrl(`${DRIVE_NODE_URL}/revisions/1e3/blocks/0`) },
      ];
      for (const { method, url } of cases) {
        const res = await server.inject({ method, url });
        expect(res.statusCode, url).toBe(400);
      }
      expect(workerCalls).toHaveLength(0);
    });

    it("enrolls under the session's email, never one the client sends", async () => {
      actorRoles = ["support_agent"];
      const b64 = (n: number) => Buffer.alloc(n, 3).toString("base64");
      const res = await server.inject({
        method: "POST",
        url: "/admin/v1/drive/account",
        headers: { "content-type": "application/json", "x-somnus-actor-email": "evil@x.com" },
        payload: JSON.stringify({
          encPublicKey: b64(91),
          signPublicKey: b64(91),
          privateKeys: { iv: b64(12), ct: b64(300) },
          passphraseWrap: {
            kdf: "PBKDF2-SHA256",
            iterations: 600000,
            salt: b64(16),
            iv: b64(12),
            ct: b64(48),
          },
          recoveryWrap: { kdf: "HKDF-SHA256", salt: b64(16), iv: b64(12), ct: b64(48) },
        }),
      });
      expect(res.statusCode).not.toBe(400);
      expect(workerCalls.map((c) => c.path)).toEqual(["/internal/v1/drive/account"]);
      expect(driveHeaders.at(-1)?.["x-somnus-actor-email"]).toBe("admin@example.com");
      expect(driveHeaders.at(-1)?.["x-somnus-actor-id"]).toBe(ACTOR);
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
