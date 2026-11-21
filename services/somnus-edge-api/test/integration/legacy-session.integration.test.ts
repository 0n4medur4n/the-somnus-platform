import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { UUIDv7 } from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { applyHardening } from "../../src/bootstrap/harden.js";
import { loadEdgeConfig } from "../../src/config/edge-config.js";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import {
  IDENTITY_CLIENT,
  MORPHEO_CLIENT,
} from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { OptionalSessionGuard } from "../../src/modules/sessions/optional-session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { clearFirestoreEmulator } from "../support/emulator.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

/**
 * A session document from before client, amr, authTime and stepUpAt. It has
 * to pass the guards and GET /admin/v1/me exactly as it does today, and a
 * read must not write those fields back.
 */
const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const LEGACY_KEYS = ["createdAt", "email", "expiresAt", "firebaseUid", "revokedAt"];

describe("a session document with none of the new fields", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const config = loadEdgeConfig(process.env);

  beforeAll(async () => {
    const identity = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/users/resolve") {
        return {
          status: 200,
          body: { userId: ACTOR, email: "legacy@example.com", locale: "es", status: "active" },
        };
      }
      if (req.path === "/internal/v1/authorization/admin-context") {
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
            user: { id: ACTOR, email: "legacy@example.com", locale: "es", status: "active" },
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
    const morpheo = makeFakeIdentityClient((req) =>
      req.path === "/internal/v1/funnel/config"
        ? { status: 200, body: { activeFlow: "v1" } }
        : { status: 404, body: {} },
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
      .useValue(identity.client)
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(morpheo.client)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: config.BODY_LIMIT_BYTES }),
    );
    await applyHardening(app, config);
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearFirestoreEmulator();
  });

  async function legacyDocument(): Promise<{ sessionId: string; cookie: string }> {
    const sessionId = UUIDv7();
    const createdAt = new Date(Date.now() - 60_000);
    await app
      .get(FirebaseService)
      .firestore.collection("sessions")
      .doc(sessionId)
      .set({
        firebaseUid: "legacy-uid",
        email: "legacy@example.com",
        createdAt: Timestamp.fromDate(createdAt),
        expiresAt: Timestamp.fromMillis(createdAt.getTime() + 3_600_000),
        revokedAt: null,
      });
    const cookie = `${config.SESSION_COOKIE_NAME}=${encodeURIComponent(server.signCookie(sessionId))}`;
    return { sessionId, cookie };
  }

  async function keysOf(sessionId: string): Promise<string[]> {
    const snap = await app
      .get(FirebaseService)
      .firestore.collection("sessions")
      .doc(sessionId)
      .get();
    return Object.keys(snap.data() ?? {}).sort();
  }

  it("passes SessionGuard, OptionalSessionGuard and GET /admin/v1/me, and stays unchanged", async () => {
    const { sessionId, cookie } = await legacyDocument();
    expect(await keysOf(sessionId)).toEqual(LEGACY_KEYS);

    const guard = app.get(OptionalSessionGuard);
    const request: {
      cookies: Record<string, string>;
      unsignCookie: FastifyInstance["unsignCookie"];
      session?: SessionRecord;
    } = {
      cookies: { [config.SESSION_COOKIE_NAME]: server.signCookie(sessionId) },
      unsignCookie: server.unsignCookie.bind(server),
    };
    const allowed = await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext);
    expect(allowed).toBe(true);
    expect(request.session?.firebaseUid).toBe("legacy-uid");
    expect(request.session).not.toHaveProperty("client");
    expect(request.session).not.toHaveProperty("amr");
    expect(request.session).not.toHaveProperty("authTime");
    expect(request.session).not.toHaveProperty("stepUpAt");

    const funnel = await server.inject({
      method: "GET",
      url: "/v1/funnel/config",
      headers: { cookie },
    });
    expect(funnel.statusCode).toBe(200);
    expect(funnel.json()).toEqual({ activeFlow: "v1" });

    const csrf = await server.inject({
      method: "GET",
      url: "/v1/sessions/csrf",
      headers: { cookie },
    });
    expect(csrf.statusCode).toBe(200);
    expect(Object.keys(csrf.json() as object).sort()).toEqual(["csrfToken"]);
    expect(await keysOf(sessionId)).toEqual(LEGACY_KEYS);

    const me = await server.inject({
      method: "GET",
      url: "/admin/v1/me",
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      user: { id: ACTOR, email: "legacy@example.com", locale: "es", status: "active" },
      roleKeys: ["platform_super_admin"],
      capabilities: ["admin_roles_assign"],
    });

    expect(await keysOf(sessionId)).toEqual([...LEGACY_KEYS, "somnusUserId"]);
    const stored = await app
      .get(FirebaseService)
      .firestore.collection("sessions")
      .doc(sessionId)
      .get();
    expect(stored.data()?.["somnusUserId"]).toBe(ACTOR);
    expect(stored.data()).not.toHaveProperty("client");
    expect(stored.data()).not.toHaveProperty("amr");
    expect(stored.data()).not.toHaveProperty("authTime");
    expect(stored.data()).not.toHaveProperty("stepUpAt");
    expect(stored.data()).not.toHaveProperty("lastSeenAt");
  });
});
