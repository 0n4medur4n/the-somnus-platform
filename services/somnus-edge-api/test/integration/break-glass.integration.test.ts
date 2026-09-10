import type { ExecutionContext } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  BREAK_GLASS_EVENT_TYPE,
  BREAK_GLASS_JUSTIFICATION_MIN_LENGTH,
  type EventEnvelope,
  UUIDv7,
} from "@somnus/api-contracts";
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
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

/**
 * Break-glass access (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * The role gate lives in `admin-gate.integration.test.ts`, which drives every
 * internal and external role against every registered admin route and therefore
 * covers this one the moment it exists. What is asserted here is the half that
 * is specific to break-glass: that the justification is a gate rather than a
 * form field, and that the audit event it writes is worth having.
 *
 * The last point is the one to watch. §A4 asks for an event containing the
 * category, the justification AND the record id — not a generic "an admin used
 * break-glass" flag. A flag would tell a later reviewer that something happened
 * and nothing about whether it should have.
 */

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SUBJECT = "018f0000-0000-7000-8000-0000000000fe";
const GOOD_JUSTIFICATION = "Safeguarding escalation raised by the on-call clinician this morning.";

const SESSION: SessionRecord = {
  sessionId: "018f0000-0000-7000-8000-000000000001",
  firebaseUid: "firebase-uid-1",
  email: "reviewer@example.com",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  somnusUserId: ACTOR,
};

const SNAPSHOT = {
  snapshotId: "snap-1",
  sessionId: "sess-1",
  result: {
    role: "adult",
    level: "L4",
    stop: false,
    privacyBlock: false,
    routes: ["INS"],
    triggeredRules: [],
    workflowVersion: "1.0",
    contentVersion: "1.0",
  },
  workflowVersion: "1.0",
  contentVersion: "1.0",
  createdAt: "2026-09-04T09:00:00.000Z",
};

describe("break-glass reveal (POST /admin/v1/break-glass/reveal)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let published: EventEnvelope[];
  let morpheoCalls: Array<{ path: string; body: unknown }>;

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
            roleKeys: ["clinical_governance_reviewer"],
            capabilities: ["admin_break_glass"],
          },
        };
      }
      return { status: 404, body: {} };
    });

    morpheoCalls = [];
    const morpheoStub = {
      get: async () => ({ status: 200, body: {} }),
      post: async (path: string, options: { body?: unknown }) => {
        morpheoCalls.push({ path, body: options.body });
        return { status: 200, body: { snapshots: [SNAPSHOT] } };
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
  });

  function reveal(payload: unknown) {
    return server.inject({
      method: "POST",
      url: "/admin/v1/break-glass/reveal",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  }

  // --- The justification is a gate, not a form field ---

  it("refuses to reveal anything without a justification", async () => {
    const res = await reveal({ subjectUserId: SUBJECT, category: "safety" });

    expect(res.statusCode).toBe(400);
    // Nothing was fetched. The refusal happens before the clinical record is
    // touched, so an admin cannot provoke a read and then decline to explain it.
    expect(morpheoCalls).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it("refuses a justification below the minimum length", async () => {
    const tooShort = "x".repeat(BREAK_GLASS_JUSTIFICATION_MIN_LENGTH - 1);
    const res = await reveal({
      subjectUserId: SUBJECT,
      category: "support",
      justification: tooShort,
    });

    expect(res.statusCode).toBe(400);
    expect(morpheoCalls).toHaveLength(0);
  });

  it("does not accept whitespace as a justification", async () => {
    const res = await reveal({
      subjectUserId: SUBJECT,
      category: "support",
      justification: " ".repeat(BREAK_GLASS_JUSTIFICATION_MIN_LENGTH + 10),
    });

    expect(res.statusCode).toBe(400);
    expect(morpheoCalls).toHaveLength(0);
  });

  it("refuses a category outside the four §A2.3 names", async () => {
    const res = await reveal({
      subjectUserId: SUBJECT,
      category: "curiosity",
      justification: GOOD_JUSTIFICATION,
    });

    expect(res.statusCode).toBe(400);
    expect(morpheoCalls).toHaveLength(0);
  });

  // --- The reveal itself ---

  it("returns the individual's records once, with no unlock of any kind", async () => {
    const res = await reveal({
      subjectUserId: SUBJECT,
      category: "safety",
      justification: GOOD_JUSTIFICATION,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { snapshots: unknown[]; subjectUserId: string; revealedAt: string };
    expect(body.subjectUserId).toBe(SUBJECT);
    expect(body.snapshots).toHaveLength(1);
    expect(body.revealedAt).toBeTruthy();

    // Nothing is handed back that could be replayed instead of a justification:
    // no cookie is set, and the body carries no grant, token or expiry.
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(Object.keys(body)).toEqual(["subjectUserId", "revealedAt", "auditEventId", "snapshots"]);
  });

  it("asks morpheo for that person's records and nobody else's", async () => {
    await reveal({ subjectUserId: SUBJECT, category: "legal", justification: GOOD_JUSTIFICATION });

    expect(morpheoCalls).toHaveLength(1);
    expect(morpheoCalls[0]?.path).toBe("/internal/v1/assessments/by-user");
    expect(morpheoCalls[0]?.body).toEqual({ userId: SUBJECT });
  });

  it("needs a fresh justification every time: two reveals, two justifications", async () => {
    await reveal({
      subjectUserId: SUBJECT,
      category: "support",
      justification: GOOD_JUSTIFICATION,
    });
    // The second call carries no justification, and is refused exactly as the
    // first would have been. There is no state left over from the first to
    // shortcut it -- which is what "shown for that session only" means here.
    const second = await reveal({ subjectUserId: SUBJECT, category: "support" });

    expect(second.statusCode).toBe(400);
    expect(morpheoCalls).toHaveLength(1);
  });

  // --- The audit event ---

  it("writes exactly one audit event, carrying the record, the category and the reason", async () => {
    const res = await reveal({
      subjectUserId: SUBJECT,
      category: "safety",
      justification: GOOD_JUSTIFICATION,
    });

    // Still one event per admin call: the 15.1 invariant is not relaxed for
    // this route, the interceptor's own event is enriched instead.
    expect(published).toHaveLength(1);
    const event = published[0] as EventEnvelope;

    expect(event.eventType).toBe(BREAK_GLASS_EVENT_TYPE);
    expect(event.actor).toEqual({ type: "user", id: ACTOR });
    // The subject is the person whose record was opened, not the admin: an audit
    // log has to be able to answer "who has looked at this person's data".
    expect(event.subject).toEqual({ type: "user", id: SUBJECT });
    expect(event.data).toMatchObject({
      adminId: ACTOR,
      category: "safety",
      justification: GOOD_JUSTIFICATION,
    });

    // And the admin is told which record their access wrote, so they can find
    // it in the viewer themselves.
    expect((res.json() as { auditEventId: string }).auditEventId).toBe(event.eventId);
  });

  it("records the category the admin chose, not a default", async () => {
    for (const category of ["support", "safety", "legal", "other"] as const) {
      published.length = 0;
      await reveal({ subjectUserId: SUBJECT, category, justification: GOOD_JUSTIFICATION });
      expect((published[0] as EventEnvelope).data["category"]).toBe(category);
    }
  });

  it("records nothing when the reveal is refused", async () => {
    await reveal({ subjectUserId: SUBJECT, category: "safety", justification: "too short" });
    // A refused request is not an access. Recording one would put a
    // break-glass event in the log for something that never revealed anything.
    expect(published).toHaveLength(0);
  });
});
