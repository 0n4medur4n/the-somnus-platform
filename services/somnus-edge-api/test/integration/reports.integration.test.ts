import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { applyHardening } from "../../src/bootstrap/harden.js";
import { loadEdgeConfig } from "../../src/config/edge-config.js";
import { REPORT_CLIENT } from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import {
  makeFakeIdentityClient,
  type RecordedRequest,
  type Responder,
} from "../support/fake-identity.js";

const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "u@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: "018f0000-0000-7000-8000-0000000000ac",
};

const RENDER_BODY = {
  assessmentId: "a1",
  definitionVersion: "1.0",
  contentVersion: "1.2",
  locale: "es",
  role: "adult",
  level: "L4",
  stop: false,
  triggeredRules: [],
  routes: ["INS"],
  completedAt: "2026-08-18T10:00:00Z",
};

const REPORT_REF = {
  reportId: "rep-1",
  assessmentId: "a1",
  templateVersion: "report_v1",
  definitionVersion: "1.0",
  contentVersion: "1.2",
  locale: "es",
  createdAt: "2026-08-18T10:00:05Z",
  htmlUrl: "http://127.0.0.1:8081/reports/rep-1/es/report.html?expires=9999999999",
  pdfUrl: "http://127.0.0.1:8081/reports/rep-1/es/report.pdf?expires=9999999999",
};

const passGuard = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest<{ session?: SessionRecord }>().session = SESSION;
    return true;
  },
};

describe("edge-api reports proxy (build plan §20 Checkpoint 11.1)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let requests: RecordedRequest[];
  let respond: Responder;

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => respond(req));
    requests = fake.requests;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REPORT_CLIENT)
      .useValue(fake.client)
      .overrideGuard(SessionGuard)
      .useValue(passGuard)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("proxies a render request and returns the signed ReportRef", async () => {
    respond = (req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/internal/v1/reports");
      expect(JSON.parse(req.body ?? "{}")).toMatchObject({ assessmentId: "a1", level: "L4" });
      return { status: 200, body: REPORT_REF };
    };
    const res = await server.inject({ method: "POST", url: "/v1/reports", payload: RENDER_BODY });
    expect(res.statusCode).toBe(201);
    const ref = res.json();
    expect(ref.reportId).toBe("rep-1");
    expect(ref.htmlUrl).toContain("expires=");
    expect(ref.pdfUrl).toContain("expires=");
  });

  it("rejects a render the Zod contract refuses (unknown role) at the edge", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/reports",
      payload: { ...RENDER_BODY, role: "wizard" },
    });
    expect(res.statusCode).toBe(400);
    expect(requests.some((r) => r.body?.includes("wizard"))).toBe(false);
  });
});

describe("edge-api reports CSRF posture (build plan §21)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    const fake = makeFakeIdentityClient(() => ({ status: 200, body: REPORT_REF }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REPORT_CLIENT)
      .useValue(fake.client)
      .overrideGuard(SessionGuard)
      .useValue(passGuard)
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

  it("the authenticated report render requires a CSRF token", async () => {
    const res = await server.inject({ method: "POST", url: "/v1/reports", payload: RENDER_BODY });
    expect(res.statusCode).toBe(403);
  });
});
