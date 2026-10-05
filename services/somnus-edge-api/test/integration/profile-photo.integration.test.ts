import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { csrfTokenFor } from "../../src/bootstrap/csrf-token.js";
import { applyHardening } from "../../src/bootstrap/harden.js";
import { loadEdgeConfig } from "../../src/config/edge-config.js";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import {
  IDENTITY_CLIENT,
  MORPHEO_CLIENT,
} from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient, type RecordedRequest } from "../support/fake-identity.js";
import { jpeg, webp } from "../support/images.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "u@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: ACTOR,
};

/**
 * The profile photo and the person's own assessment history, through the real
 * hardened app: the raw-image parser, its 1 MB ceiling, CSRF on every write,
 * and the §16 error shape. Identity and morpheo are faked; the photo store is
 * the in-memory one a non-production process uses.
 */
describe("profile photo + own assessments (edge-api)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let identityRequests: RecordedRequest[];
  let morpheoRequests: RecordedRequest[];
  let cookieHeader: string;
  const config = loadEdgeConfig(process.env);
  const csrf = csrfTokenFor(SESSION.sessionId, config.COOKIE_SECRET);

  beforeAll(async () => {
    const identity = makeFakeIdentityClient(() => ({ status: 204 }));
    identityRequests = identity.requests;
    const morpheo = makeFakeIdentityClient((req) =>
      req.path === "/internal/v1/assessments/mine"
        ? {
            status: 200,
            body: {
              assessments: [
                {
                  sessionId: "sess-2",
                  role: "adult",
                  level: "L3",
                  stop: false,
                  createdAt: "2026-10-05T09:30:00+00:00",
                },
              ],
            },
          }
        : { status: 404, body: {} },
    );
    morpheoRequests = morpheo.requests;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
      .useValue(identity.client)
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(morpheo.client)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ session?: SessionRecord }>().session = SESSION;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: config.BODY_LIMIT_BYTES }),
    );
    await applyHardening(app, config);
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    cookieHeader = `${config.SESSION_COOKIE_NAME}=${server.signCookie(SESSION.sessionId)}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    identityRequests.length = 0;
    morpheoRequests.length = 0;
  });

  const upload = (body: Buffer, contentType: string, withCsrf = true) =>
    server.inject({
      method: "PUT",
      url: "/v1/me/photo",
      headers: {
        cookie: cookieHeader,
        "content-type": contentType,
        ...(withCsrf ? { "x-csrf-token": csrf } : {}),
      },
      payload: body,
    });

  it("stores a WebP, tells identity a photo exists, and serves it back privately", async () => {
    const photo = webp();
    const res = await upload(photo, "image/webp");
    expect(res.statusCode).toBe(204);

    expect(identityRequests).toHaveLength(1);
    expect(identityRequests[0]).toMatchObject({ method: "PUT", path: "/v1/me/profile/photo" });
    expect(identityRequests[0]?.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
    // Identity learns only that there is a photo -- never the bytes.
    expect(JSON.parse(identityRequests[0]?.body ?? "{}")).toEqual({ present: true });

    const got = await server.inject({
      method: "GET",
      url: "/v1/me/photo",
      headers: { cookie: cookieHeader },
    });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(photo)).toBe(true);
    expect(got.headers["content-type"]).toBe("image/webp");
    expect(got.headers["cache-control"]).toBe("private, max-age=86400");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["cross-origin-resource-policy"]).toBe("same-site");
  });

  it("accepts a clean JPEG (Safari re-encodes to JPEG)", async () => {
    expect((await upload(jpeg(), "image/jpeg")).statusCode).toBe(204);
  });

  it("refuses a photo that still carries EXIF, before anything is stored", async () => {
    const res = await upload(jpeg({ exif: true }), "image/jpeg");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(identityRequests).toHaveLength(0);
  });

  it("refuses bytes that are not what the content type says", async () => {
    expect((await upload(Buffer.from("<svg onload=alert(1)>"), "image/webp")).statusCode).toBe(400);
  });

  it("refuses any other content type, and anything over 1 MB", async () => {
    expect((await upload(Buffer.from("x"), "image/svg+xml")).statusCode).toBe(415);
    const big = Buffer.concat([webp(), Buffer.alloc(1024 * 1024)]);
    expect((await upload(big, "image/webp")).statusCode).toBe(413);
  });

  it("is CSRF-protected like every other write", async () => {
    expect((await upload(webp(), "image/webp", false)).statusCode).toBe(403);
    expect(identityRequests).toHaveLength(0);
  });

  it("removes the photo, after which there is nothing to serve", async () => {
    await upload(webp(), "image/webp");
    identityRequests.length = 0;

    const removed = await server.inject({
      method: "DELETE",
      url: "/v1/me/photo",
      headers: { cookie: cookieHeader, "x-csrf-token": csrf },
    });
    expect(removed.statusCode).toBe(204);
    expect(JSON.parse(identityRequests[0]?.body ?? "{}")).toEqual({ present: false });

    const got = await server.inject({
      method: "GET",
      url: "/v1/me/photo",
      headers: { cookie: cookieHeader },
    });
    expect(got.statusCode).toBe(404);
  });

  it("GET /v1/assessments/mine asks morpheo for the signed-in person's own history", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/assessments/mine",
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      assessments: [
        {
          sessionId: "sess-2",
          role: "adult",
          level: "L3",
          stop: false,
          createdAt: "2026-10-05T09:30:00+00:00",
        },
      ],
    });
    expect(morpheoRequests[0]?.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
  });
});
