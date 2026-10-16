import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import {
  MORPHEO_CLIENT,
  REPORT_CLIENT,
} from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient, type RecordedRequest } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-0000000000ac";
const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "u@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: ACTOR, // pre-resolved: no identity round-trip
};

const SNAPSHOT = {
  snapshotId: "snap-1",
  sessionId: "sess-1",
  result: {
    role: "adult",
    level: "L3",
    stop: false,
    privacyBlock: false,
    routes: ["INS"],
    triggeredRules: ["SAFE-010"],
    workflowVersion: "1.0",
    contentVersion: "1.4",
  },
  workflowVersion: "1.0",
  contentVersion: "1.4",
};
const MINE = {
  assessments: [
    {
      sessionId: "sess-1",
      role: "adult",
      level: "L3",
      stop: false,
      createdAt: "2026-10-16T09:30:00+00:00",
    },
  ],
};
const PDF = Buffer.from("%PDF-1.7 the report");

const passGuard = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest<{ session?: SessionRecord }>().session = SESSION;
    return true;
  },
};

/**
 * "Descargar informe": the report is built from Morpheo's frozen snapshot of the
 * person's own assessment -- nothing the browser sends can change what it says.
 */
describe("GET /v1/reports/assessments/:sessionId/pdf", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let morpheoRequests: RecordedRequest[];
  let reportRequests: RecordedRequest[];
  let mine = MINE;

  beforeAll(async () => {
    const morpheo = makeFakeIdentityClient((req) =>
      req.path.endsWith("/snapshot")
        ? { status: 200, body: SNAPSHOT }
        : { status: 200, body: mine },
    );
    const report = makeFakeIdentityClient((req) => ({
      status: 200,
      body: {
        assessmentId: JSON.parse(req.body ?? "{}").assessmentId,
        templateVersion: "report_v1",
        definitionVersion: "1.0",
        contentVersion: "1.4",
        locale: JSON.parse(req.body ?? "{}").locale,
        createdAt: "2026-10-16T10:00:00Z",
        pdfBase64: PDF.toString("base64"),
      },
    }));
    morpheoRequests = morpheo.requests;
    reportRequests = report.requests;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(morpheo.client)
      .overrideProvider(REPORT_CLIENT)
      .useValue(report.client)
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

  beforeEach(() => {
    morpheoRequests.length = 0;
    reportRequests.length = 0;
    mine = MINE;
  });

  it("renders the person's own frozen result as a PDF download, cached nowhere", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/reports/assessments/sess-1/pdf?locale=ca",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="the-somnus-informe-2026-10-16.pdf"',
    );
    expect(res.rawPayload.equals(PDF)).toBe(true);

    // The render request is the snapshot's result, verbatim, in the asked locale.
    expect(reportRequests).toHaveLength(1);
    expect(reportRequests[0]?.path).toBe("/internal/v1/reports/pdf");
    expect(JSON.parse(reportRequests[0]?.body ?? "{}")).toEqual({
      assessmentId: "sess-1",
      definitionVersion: "1.0",
      contentVersion: "1.4",
      locale: "ca",
      role: "adult",
      level: "L3",
      stop: false,
      triggeredRules: ["SAFE-010"],
      routes: ["INS"],
      completedAt: "2026-10-16T09:30:00+00:00",
    });
    // Asked as the actor: Morpheo scopes the snapshot to its owner.
    expect(morpheoRequests.every((req) => req.headers["x-somnus-actor-id"] === ACTOR)).toBe(true);
  });

  it("falls back to Spanish for an unknown locale", async () => {
    await server.inject({ method: "GET", url: "/v1/reports/assessments/sess-1/pdf?locale=xx" });
    expect(JSON.parse(reportRequests[0]?.body ?? "{}")).toMatchObject({ locale: "es" });
  });

  it("refuses an assessment that is not among the person's saved ones, and renders nothing", async () => {
    mine = { assessments: [] };
    const res = await server.inject({ method: "GET", url: "/v1/reports/assessments/sess-1/pdf" });
    expect(res.statusCode).toBe(404);
    expect(reportRequests).toHaveLength(0);
  });
});
