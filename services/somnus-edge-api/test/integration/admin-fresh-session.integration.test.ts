import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient, type RecordedRequest } from "../support/fake-identity.js";

/**
 * Regression (2026-10-18): the first `/admin/v1/me` of a brand-new session --
 * the one the console makes right after sign-in -- reached the handler with no
 * Somnus id on the session. The guard had resolved it and let the admin in, but
 * the handler forwarded an empty actor id, identity answered 401/400, and the
 * super admin saw an error. The gate tests never caught it: their session is
 * always pre-resolved.
 */
const ACTOR = "018f0000-0000-7000-8000-000000000abc";

describe("admin console on a brand-new session", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let requests: RecordedRequest[];

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/users/resolve") {
        return {
          status: 200,
          body: { userId: ACTOR, email: "admin@example.com", locale: "es", status: "active" },
        };
      }
      if (req.path === "/internal/v1/authorization/admin-context") {
        const { actorUserId } = JSON.parse(req.body ?? "{}") as { actorUserId: string };
        if (!actorUserId) return { status: 400, body: { error: { code: "VALIDATION" } } };
        return {
          status: 200,
          body: { roleKeys: ["platform_super_admin"], capabilities: ["admin_roles_assign"] },
        };
      }
      if (req.path === "/v1/me") {
        if (req.headers[ACTOR_ID_HEADER] !== ACTOR) {
          return { status: 401, body: { error: { code: "UNAUTHENTICATED" } } };
        }
        return {
          status: 200,
          body: {
            user: { id: ACTOR, email: "admin@example.com", locale: "es", status: "active" },
            individualProfile: null,
            professionalProfile: null,
            account: {
              registrationRole: "adult",
              internalRoles: ["platform_super_admin"],
              organizations: [],
            },
          },
        };
      }
      return { status: 404, body: {} };
    });
    requests = fake.requests;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
      .useValue(fake.client)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          // A fresh session per request: just signed in, Somnus id not resolved yet.
          const fresh: SessionRecord = {
            sessionId: "018f0000-0000-7000-8000-00000000f5e5",
            firebaseUid: "firebase-uid-admin",
            email: "admin@example.com",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3_600_000),
            revokedAt: null,
            somnusUserId: null,
          };
          ctx.switchToHttp().getRequest<{ session?: SessionRecord }>().session = fresh;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("the super admin gets the console on the very first request", async () => {
    const res = await server.inject({ method: "GET", url: "/admin/v1/me" });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { roleKeys: string[] }).roleKeys).toEqual(["platform_super_admin"]);
    // Every identity call after resolution carried the resolved actor, never "".
    const me = requests.find((r) => r.path === "/v1/me");
    expect(me?.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
    const contexts = requests.filter((r) => r.path === "/internal/v1/authorization/admin-context");
    expect(contexts.length).toBeGreaterThan(0);
    for (const c of contexts) {
      expect((JSON.parse(c.body ?? "{}") as { actorUserId: string }).actorUserId).toBe(ACTOR);
    }
  });
});
