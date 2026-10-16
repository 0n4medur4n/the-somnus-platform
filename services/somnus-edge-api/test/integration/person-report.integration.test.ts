import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import {
  MORPHEO_CLIENT,
  REPORT_CLIENT,
} from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { makeFakeIdentityClient, type RecordedRequest } from "../support/fake-identity.js";

const SUMMARY = {
  role: "adult",
  level: "L3",
  stop: false,
  privacyBlock: false,
  routes: ["INS"],
  triggeredRules: [],
  workflowVersion: "1.0",
  contentVersion: "1.4",
};
const REPORT = {
  assessmentId: "sess-1",
  locale: "ca",
  generated: true,
  narrative: {
    summary: "Ens has explicat que et costa dormir.",
    whatToDo: ["Demana una consulta programada."],
    patterns: [{ name: "Dificultat per dormir", why: "Has descrit despertars." }],
    recommendations: ["Porta un diari de son de 14 dies."],
    prepare: ["Apunta des de quan et passa."],
  },
};

/**
 * The person's AI-written report: built from Morpheo's own result for the
 * session -- nothing the browser sends can change what it says -- and public
 * like that result is, signed in or not.
 */
describe("GET /v1/assessments/:sessionId/report", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let morpheoRequests: RecordedRequest[];
  let reportRequests: RecordedRequest[];

  beforeAll(async () => {
    const morpheo = makeFakeIdentityClient(() => ({ status: 200, body: SUMMARY }));
    const report = makeFakeIdentityClient(() => ({ status: 200, body: REPORT }));
    morpheoRequests = morpheo.requests;
    reportRequests = report.requests;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(morpheo.client)
      .overrideProvider(REPORT_CLIENT)
      .useValue(report.client)
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
  });

  it("asks the report service for the person's report of Morpheo's own result", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/assessments/sess-1/report?locale=ca",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(REPORT);
    expect(morpheoRequests[0]?.path).toBe("/internal/v1/assessments/sess-1/summary");
    expect(reportRequests[0]?.path).toBe("/internal/v1/reports/narrative");
    expect(JSON.parse(reportRequests[0]?.body ?? "{}")).toMatchObject({
      assessmentId: "sess-1",
      locale: "ca",
      role: "adult",
      level: "L3",
      routes: ["INS"],
      triggeredRules: [],
    });
  });

  it("falls back to Spanish for an unknown locale", async () => {
    await server.inject({ method: "GET", url: "/v1/assessments/sess-1/report?locale=xx" });
    expect(JSON.parse(reportRequests[0]?.body ?? "{}")).toMatchObject({ locale: "es" });
  });
});
