import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { UUIDv7 } from "@somnus/api-contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import {
  makeFakeIdentityClient,
  type RecordedRequest,
  type Responder,
} from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";

const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "u@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  // Pre-resolved so the guard-injected session skips the resolve
  // round-trip; the resolve path itself is covered in actor-resolver.test.
  somnusUserId: ACTOR,
};

/**
 * App-level composition: boots the real AppModule (so the controllers,
 * global ZodValidationPipe, correlation interceptor, and the §16
 * exception filter all run) with the session guard and the identity
 * client replaced. Proves edge exposes the composed routes, forwards
 * the actor + correlation id, and normalizes downstream errors into the
 * §16 shape.
 */
describe("edge-api composition routes (build plan §20 Checkpoint 8.2)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let requests: RecordedRequest[];
  let respond: Responder;

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => respond(req));
    requests = fake.requests;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
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

  it("GET /v1/me composes identity and forwards actor + correlation", async () => {
    const body = {
      user: { id: UUIDv7(), email: "u@example.com", locale: "es", status: "active" },
      individualProfile: null,
      professionalProfile: null,
    };
    respond = (req) => {
      expect(req.path).toBe("/v1/me");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      expect(req.headers["x-correlation-id"]).toBe("corr-me");
      return { status: 200, body };
    };

    const res = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-correlation-id": "corr-me" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
  });

  it("normalizes a downstream 404 into the §16 error shape", async () => {
    respond = () => ({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "gone", correlationId: "x" } },
    });

    const res = await server.inject({ method: "GET", url: "/v1/me" });

    expect(res.statusCode).toBe(404);
    const err = res.json() as { error: { code: string; correlationId: string } };
    expect(err.error.code).toBe("NOT_FOUND");
    expect(err.error.correlationId).toBeTruthy();
  });

  it("GET /v1/consents/current forwards the actor id", async () => {
    respond = (req) => {
      expect(req.path).toBe("/v1/consents/current");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body: { purposes: [] } };
    };

    const res = await server.inject({ method: "GET", url: "/v1/consents/current" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ purposes: [] });
  });

  it("GET /v1/legal-documents/current is public and forwards the locale", async () => {
    respond = (req) => {
      expect(req.path).toBe("/v1/legal-documents/current");
      expect(req.url).toContain("locale=ca");
      return { status: 200, body: { documents: [] } };
    };

    const res = await server.inject({
      method: "GET",
      url: "/v1/legal-documents/current?locale=ca",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ documents: [] });
    expect(requests.at(-1)?.path).toBe("/v1/legal-documents/current");
  });
});
