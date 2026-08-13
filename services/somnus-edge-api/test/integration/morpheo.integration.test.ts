import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { applyHardening } from "../../src/bootstrap/harden.js";
import { loadEdgeConfig } from "../../src/config/edge-config.js";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { MORPHEO_CLIENT } from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import {
  makeFakeIdentityClient,
  type RecordedRequest,
  type Responder,
} from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-0000000000ac";

const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "u@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: ACTOR, // pre-resolved so ActorResolver skips the identity round-trip
};

const RESULT = {
  role: "adult",
  level: "L1",
  stop: true,
  privacyBlock: false,
  routes: ["SLP"],
  triggeredRules: ["SAFE-003"],
  workflowVersion: "1.0",
  contentVersion: "1.0",
};

describe("edge-api morpheo proxy (build plan §20 Checkpoint 10.3)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let requests: RecordedRequest[];
  let respond: Responder;

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => respond(req));
    requests = fake.requests;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(fake.client)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ session?: SessionRecord }>();
          req.session = SESSION;
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

  it("proxies create to morpheo and returns the outcome", async () => {
    respond = (req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/internal/v1/assessments");
      expect(JSON.parse(req.body ?? "{}")).toMatchObject({ role: "adult", consentGiven: true });
      return { status: 200, body: { allowed: true, sessionId: "sess-1", reason: null } };
    };

    const res = await server.inject({
      method: "POST",
      url: "/v1/assessments",
      payload: { role: "adult", consentGiven: true, ageYears: 35 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ allowed: true, sessionId: "sess-1", reason: null });
  });

  it("proxies an answer and returns the re-evaluated result", async () => {
    respond = (req) => {
      expect(req.path).toBe("/internal/v1/assessments/sess-1/answers");
      expect(JSON.parse(req.body ?? "{}")).toMatchObject({
        kind: "signal",
        name: "sleepiness_near_miss",
      });
      return { status: 200, body: RESULT };
    };

    const res = await server.inject({
      method: "POST",
      url: "/v1/assessments/sess-1/answers",
      payload: { kind: "signal", name: "sleepiness_near_miss", value: "true" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ level: "L1", stop: true, routes: ["SLP"] });
  });

  it("proxies the summary read", async () => {
    respond = (req) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/internal/v1/assessments/sess-1/summary");
      return { status: 200, body: RESULT };
    };
    const res = await server.inject({ method: "GET", url: "/v1/assessments/sess-1/summary" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ level: "L1" });
  });

  it("mints a claim token", async () => {
    respond = (req) => {
      expect(req.path).toBe("/internal/v1/assessments/sess-1/claim-token");
      return { status: 200, body: { token: "tok-123" } };
    };
    const res = await server.inject({ method: "POST", url: "/v1/assessments/sess-1/claim-token" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ token: "tok-123" });
  });

  it("claim forwards the resolved actor, never the browser", async () => {
    respond = (req) => {
      expect(req.path).toBe("/internal/v1/assessments/claim");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      expect(JSON.parse(req.body ?? "{}")).toEqual({ token: "tok-123" });
      return { status: 200, body: { success: true, snapshotId: "snap-1", reason: null } };
    };
    const res = await server.inject({
      method: "POST",
      url: "/v1/assessments/claim",
      payload: { token: "tok-123" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: true, snapshotId: "snap-1", reason: null });
  });

  it("snapshot is actor-scoped", async () => {
    respond = (req) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/internal/v1/assessments/sess-1/snapshot");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return {
        status: 200,
        body: {
          snapshotId: "snap-1",
          sessionId: "sess-1",
          result: RESULT,
          workflowVersion: "1.0",
          contentVersion: "1.0",
        },
      };
    };
    const res = await server.inject({ method: "GET", url: "/v1/assessments/sess-1/snapshot" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ snapshotId: "snap-1" });
  });

  it("normalizes a downstream error into the §16 shape", async () => {
    respond = () => ({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "no", correlationId: "x", details: {} } },
    });
    const res = await server.inject({ method: "GET", url: "/v1/assessments/nope/summary" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a create the Zod contract refuses (unknown role) at the edge", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/assessments",
      payload: { role: "wizard", consentGiven: true },
    });
    expect(res.statusCode).toBe(400);
    // Never reached morpheo: the last recorded request is not a create for this role.
    expect(requests.some((r) => r.body?.includes("wizard"))).toBe(false);
  });
});

describe("edge-api morpheo CSRF posture (build plan §21)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    const fake = makeFakeIdentityClient(() => ({
      status: 200,
      body: { allowed: true, sessionId: "sess-1", reason: null },
    }));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(fake.client)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ session?: SessionRecord }>().session = SESSION;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await applyHardening(app, loadEdgeConfig(process.env));
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("anonymous create is exempt from CSRF (no token required)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/assessments",
      payload: { role: "adult", consentGiven: true },
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(201);
  });

  it("the authenticated claim requires a CSRF token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/assessments/claim",
      payload: { token: "tok-123" }, // no x-csrf-token
    });
    expect(res.statusCode).toBe(403);
  });
});
