import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  type EventEnvelope,
  FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH,
  UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import {
  EDGE_EVENT_PUBLISHER,
  type EventPublisher,
} from "../../src/infrastructure/events/event-publisher.js";
import {
  IDENTITY_CLIENT,
  MORPHEO_CLIENT,
} from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { MORPHEO_CASE_OPENED_EVENT_TYPE } from "../../src/modules/admin/admin-morpheo-cases.controller.js";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

/**
 * Morpheo's case records in the console (ADR 0024).
 *
 * The role gate lives in `admin-gate.integration.test.ts`, which drives every
 * role against every registered admin route. What is asserted here is what is
 * specific to cases: the justification is a gate, the acting admin reaches
 * morpheo (which records the opening), the statistics are counts, and the audit
 * event names the case without carrying the admin's free text into the logs.
 */

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const CODE = "SOM-7K3F-Q9XA";
const WHY = "Formal complaint received this morning, file 12.";

const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "owner@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: ACTOR,
};

const CASE = {
  caseCode: CODE,
  status: "finished",
  startedAt: "2026-11-01T09:00:00+00:00",
  closedAt: "2026-11-01T09:12:00+00:00",
  contentVersion: "2.2",
  rulesVersion: "2.2",
  interviewDeleted: false,
  records: [
    {
      recordedAt: "2026-11-01T09:12:00+00:00",
      status: "finished",
      reconstructed: false,
      contentVersion: "2.2",
      rulesVersion: "2.2",
      history: [{ key: "AGE", question: "¿Qué edad tiene?", answer: "45 años" }],
      result: { mainAction: "TERAPIA", texts: [] },
    },
  ],
  changes: [],
  accesses: [
    {
      accessedAt: "2026-11-03T10:00:00+00:00",
      actorId: ACTOR,
      category: "legal",
      justification: WHY,
    },
  ],
};

const STATS = {
  started: 3,
  byStatus: { open: 1, finished: 1, stopped: 1, paused: 0 },
  closed: 2,
  byMainAction: [{ key: "TERAPIA", count: 1 }],
  byTemplate: [{ key: "T_INSOMNIO", count: 1 }],
  byAlert: [],
  withAlerts: 0,
  byMonth: [{ month: "2026-11", started: 3, closed: 2 }],
  firstStartedAt: "2026-11-01T09:00:00+00:00",
  lastStartedAt: "2026-11-02T09:00:00+00:00",
};

describe("Morpheo cases (POST /admin/v1/morpheo/*)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let published: EventEnvelope[];
  let morpheoCalls: Array<{ path: string; body: unknown; headers: Record<string, string> }>;
  let morpheoAnswer: () => { status: number; body: unknown };

  beforeAll(async () => {
    const fake = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/authorization/admin-check") {
        return {
          status: 200,
          body: { allowed: true, decisionId: UUIDv7(), reasonCode: "AUTHORIZED_BY_INTERNAL_ROLE" },
        };
      }
      if (req.path === "/internal/v1/authorization/admin-context") {
        return {
          status: 200,
          body: {
            roleKeys: ["platform_super_admin"],
            capabilities: ["admin_statistics_read", "admin_morpheo_case_read"],
          },
        };
      }
      return { status: 404, body: {} };
    });

    morpheoCalls = [];
    const morpheoStub = {
      get: async () => ({ status: 200, body: {} }),
      post: async (path: string, options: { body?: unknown; headers?: Record<string, string> }) => {
        morpheoCalls.push({ path, body: options.body, headers: options.headers ?? {} });
        return morpheoAnswer();
      },
    };

    published = [];
    const capturingPublisher: EventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_CLIENT)
      .useValue(fake.client)
      .overrideProvider(MORPHEO_CLIENT)
      .useValue(morpheoStub)
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

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    published.length = 0;
    morpheoCalls.length = 0;
    morpheoAnswer = () => ({ status: 200, body: CASE });
  });

  function post(url: string, payload: unknown) {
    return server.inject({
      method: "POST",
      url,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  }

  const open = (payload: unknown) => post("/admin/v1/morpheo/cases/open", payload);

  // --- The justification is a gate ---

  it("opens nothing without a category and a real justification", async () => {
    for (const payload of [
      { caseCode: CODE, category: "legal" },
      {
        caseCode: CODE,
        category: "legal",
        justification: "x".repeat(FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH - 1),
      },
      { caseCode: CODE, category: "legal", justification: " ".repeat(40) },
      { caseCode: CODE, category: "curiosity", justification: WHY },
      { caseCode: CODE, category: "legal", justification: WHY, unlock: true },
    ]) {
      expect((await open(payload)).statusCode).toBe(400);
    }
    // Refused before morpheo is asked: nothing was read, nothing is recorded.
    expect(morpheoCalls).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  // --- The case ---

  it("asks morpheo for that case as the acting admin, and returns it", async () => {
    const res = await open({ caseCode: CODE, category: "legal", justification: WHY });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(CASE);
    expect(morpheoCalls).toHaveLength(1);
    expect(morpheoCalls[0]?.path).toBe("/internal/v1/funnel/cases/open");
    expect(morpheoCalls[0]?.body).toEqual({
      caseCode: CODE,
      category: "legal",
      justification: WHY,
    });
    // Morpheo records the opening under this id.
    expect(morpheoCalls[0]?.headers["x-somnus-actor-id"]).toBe(ACTOR);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("writes one audit event naming the case, without the admin's free text", async () => {
    await open({ caseCode: CODE, category: "safety", justification: WHY });

    expect(published).toHaveLength(1);
    const event = published[0] as EventEnvelope;
    expect(event.eventType).toBe(MORPHEO_CASE_OPENED_EVENT_TYPE);
    expect(event.actor).toEqual({ type: "user", id: ACTOR });
    expect(event.subject).toEqual({ type: "morpheo_case", id: CODE });
    expect(event.data).toEqual({
      capability: "admin_morpheo_case_read",
      adminId: ACTOR,
      category: "safety",
    });
    expect(JSON.stringify(event)).not.toContain(WHY);
  });

  it("reads an unknown case as not found, and records no opening", async () => {
    morpheoAnswer = () => {
      throw new SomnusError(ErrorCode.NOT_FOUND, "case not found", { correlationId: "c" });
    };
    const res = await open({ caseCode: "SOM-0000-0000", category: "legal", justification: WHY });

    expect(res.statusCode).toBe(404);
    expect(published).toHaveLength(0);
  });

  it("refuses a case morpheo did not shape as promised", async () => {
    morpheoAnswer = () => ({ status: 200, body: { ...CASE, ownerId: "user-1" } });
    const res = await open({ caseCode: CODE, category: "legal", justification: WHY });

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toContain("user-1");
  });

  // --- Statistics ---

  it("returns morpheo's counts for the window asked", async () => {
    morpheoAnswer = () => ({ status: 200, body: STATS });
    const window = { since: "2026-11-01T00:00:00Z" };
    const res = await post("/admin/v1/morpheo/statistics", window);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(STATS);
    expect(morpheoCalls[0]?.path).toBe("/internal/v1/funnel/cases/stats");
    expect(morpheoCalls[0]?.body).toEqual(window);
  });

  it("refuses statistics that carry anything beyond counts", async () => {
    morpheoAnswer = () => ({ status: 200, body: { ...STATS, caseCodes: [CODE] } });
    const res = await post("/admin/v1/morpheo/statistics", {});

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toContain(CODE);
  });
});
