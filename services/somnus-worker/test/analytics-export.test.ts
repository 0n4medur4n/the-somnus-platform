import {
  ANALYTICS_EVENT_TYPES,
  type AnalyticsEventType,
  type EventEnvelope,
  FORBIDDEN_ANALYTICS_FIELDS,
  makeEvent,
  opaqueId,
} from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/modules/audit/audit.service.js";
import type {
  AuditRecordInput,
  AuditRow,
  AuditStore,
} from "../src/modules/audit/db/repositories/index.js";
import {
  type AuditExportRow,
  redactForExport,
} from "../src/modules/audit/export/audit-exporter.js";
import { buildFunnels } from "../src/modules/audit/export/funnels.js";

/**
 * Addendum A Checkpoint 14.3: the BigQuery privacy-safe export for the Phase 15
 * dashboards.
 *
 * Two claims are under test here, and they are different claims:
 *
 * 1. **Redaction is structural.** For an analytics event the exporter parses
 *    `data` with the event's registered `.strict()` contract, so a forbidden
 *    field cannot survive whatever it is called. Asserted across every
 *    registered event type and every forbidden field name, not on one sample.
 * 2. **The funnels reconcile.** A known seed of registrations, verifications and
 *    invitations, pushed through the real ingest path, produces exactly the
 *    counts the seed describes -- nothing double-counted, nothing dropped.
 */

function record(over: Partial<AuditRecordInput>): AuditRecordInput {
  return {
    eventId: opaqueId(),
    eventType: "identity.registration.completed.v1",
    occurredAt: "2026-09-05T12:00:00.000Z",
    producer: "somnus-identity-service",
    correlationId: "corr-1",
    actorType: "user",
    actorId: "user-1234",
    subjectType: "user",
    subjectId: "user-9999",
    data: { roleBranch: "adult" },
    ...over,
  };
}

/** A minimal valid payload per analytics event type. */
const VALID_PAYLOADS: Record<AnalyticsEventType, Record<string, unknown>> = {
  "identity.registration.started.v1": { roleBranch: "adult" },
  "identity.registration.completed.v1": { roleBranch: "parent" },
  "identity.professional.verification.requested.v1": { caseId: opaqueId() },
  "identity.professional.verification.decided.v1": {
    caseId: opaqueId(),
    decision: "approved",
    timeToDecisionMs: 42,
  },
  "identity.organization.invitation.created.v1": { invitationId: opaqueId() },
  "identity.organization.invitation.previewed.v1": { invitationId: opaqueId() },
  "identity.organization.invitation.accepted.v1": { invitationId: opaqueId() },
  "identity.organization.invitation.expired.v1": {
    invitationId: opaqueId(),
    stage: "accept",
  },
};

describe("analytics export redaction is a property of the schema, not of the sample", () => {
  it.each(ANALYTICS_EVENT_TYPES)("%s exports exactly its declared fields", (eventType) => {
    const payload = VALID_PAYLOADS[eventType];
    const row = redactForExport(record({ eventType, data: payload }));

    expect(row.data).toEqual(payload);
    // Provenance types survive; the ids never do.
    expect(row.actorType).toBe("user");
    expect(row).not.toHaveProperty("actorId");
    expect(row).not.toHaveProperty("subjectId");
    expect(JSON.stringify(row)).not.toContain("user-1234");
    expect(JSON.stringify(row)).not.toContain("user-9999");
  });

  it.each(ANALYTICS_EVENT_TYPES)(
    "%s exports nothing at all when a forbidden field is smuggled in",
    (eventType) => {
      for (const field of FORBIDDEN_ANALYTICS_FIELDS) {
        const row = redactForExport(
          record({
            eventType,
            data: { ...VALID_PAYLOADS[eventType], [field]: "Ada Lovelace <ada@example.com>" },
          }),
        );

        // The strict contract rejects the payload, and a rejected analytics
        // payload exports as {} rather than half-trusted: no forbidden value,
        // and no partially-kept fields either.
        expect(row.data, `${eventType} leaked through "${field}"`).toEqual({});
        expect(JSON.stringify(row)).not.toContain("ada@example.com");
        expect(JSON.stringify(row)).not.toContain("Ada Lovelace");
      }
    },
  );

  it("drops an analytics payload carrying a field nobody thought to forbid", () => {
    const row = redactForExport(
      record({ data: { roleBranch: "adult", inventedYesterday: "surprise" } }),
    );
    expect(row.data).toEqual({});
  });

  it("leaves non-analytics events on the existing denylist path", () => {
    const row = redactForExport(
      record({
        eventType: "consent.receipt.recorded.v1",
        data: { purposeKey: "terms_acceptance", email: "x@y.z", token: "t" },
      }),
    );
    expect(row.data).toEqual({ purposeKey: "terms_acceptance" });
  });
});

// --- Funnel reconciliation -------------------------------------------------

class FakeStore implements AuditStore {
  rows = new Map<string, AuditRow>();

  async findByEventId(eventId: string): Promise<AuditRow | null> {
    return this.rows.get(eventId) ?? null;
  }
  async create(input: AuditRecordInput): Promise<string> {
    const id = `a-${input.eventId}`;
    this.rows.set(input.eventId, {
      id,
      ...input,
      receivedAt: new Date(),
    } as AuditRow);
    return id;
  }
}

class CollectingExporter {
  rows: AuditExportRow[] = [];
  async export(row: AuditExportRow): Promise<void> {
    this.rows.push(row);
  }
}

function event(
  eventType: AnalyticsEventType,
  data: Record<string, unknown>,
  subjectId = opaqueId(),
): EventEnvelope {
  return makeEvent({
    eventType,
    producer: "somnus-identity-service",
    correlationId: "corr-1",
    subject: { type: "thing", id: subjectId },
    data,
  });
}

describe("funnel reconciliation against a known seed", () => {
  let store: FakeStore;
  let exporter: CollectingExporter;
  let service: AuditService;

  beforeEach(() => {
    store = new FakeStore();
    exporter = new CollectingExporter();
    service = new AuditService(store, exporter);
  });

  /**
   * The seed, stated once so the expected numbers below are readable as
   * arithmetic on it rather than as magic constants.
   *
   *   Registration  adult        3 started, 3 completed
   *                 parent       2 started, 1 completed  (one submission failed)
   *                 professional 4 started, 2 completed  (two failed)
   *   Verification  3 cases opened; 2 approved (1000 ms, 5000 ms), 1 rejected (3000 ms)
   *                 -> median over [1000, 3000, 5000] = 3000
   *   Invitation    5 issued (A..E)
   *                 A previewed x3 (reloads) then accepted
   *                 B previewed x1 then expired at preview
   *                 C previewed x1, expired at preview AND again at accept
   *                 D issued only
   *                 E accepted without a preview (already signed in)
   *                 -> issued 5, previewed 3 distinct, previewViews 5,
   *                    accepted 2, expired 2
   */
  async function seed(): Promise<void> {
    const push = async (e: EventEnvelope) => {
      await service.record(e);
    };

    for (const [branch, started, completed] of [
      ["adult", 3, 3],
      ["parent", 2, 1],
      ["professional", 4, 2],
    ] as const) {
      for (let i = 0; i < started; i++) {
        await push(event("identity.registration.started.v1", { roleBranch: branch }));
      }
      for (let i = 0; i < completed; i++) {
        await push(event("identity.registration.completed.v1", { roleBranch: branch }));
      }
    }

    const caseIds = [opaqueId(), opaqueId(), opaqueId()];
    for (const caseId of caseIds) {
      await push(event("identity.professional.verification.requested.v1", { caseId }));
    }
    const decisions = [
      { caseId: caseIds[0] as string, decision: "approved", timeToDecisionMs: 1000 },
      { caseId: caseIds[1] as string, decision: "rejected", timeToDecisionMs: 3000 },
      { caseId: caseIds[2] as string, decision: "approved", timeToDecisionMs: 5000 },
    ];
    for (const decision of decisions) {
      await push(event("identity.professional.verification.decided.v1", decision));
    }

    const [a, b, c, d, e] = [opaqueId(), opaqueId(), opaqueId(), opaqueId(), opaqueId()];
    for (const invitationId of [a, b, c, d, e]) {
      await push(event("identity.organization.invitation.created.v1", { invitationId }));
    }
    for (let i = 0; i < 3; i++) {
      await push(event("identity.organization.invitation.previewed.v1", { invitationId: a }));
    }
    await push(event("identity.organization.invitation.accepted.v1", { invitationId: a }));
    await push(event("identity.organization.invitation.previewed.v1", { invitationId: b }));
    await push(
      event("identity.organization.invitation.expired.v1", { invitationId: b, stage: "preview" }),
    );
    await push(event("identity.organization.invitation.previewed.v1", { invitationId: c }));
    await push(
      event("identity.organization.invitation.expired.v1", { invitationId: c, stage: "preview" }),
    );
    await push(
      event("identity.organization.invitation.expired.v1", { invitationId: c, stage: "accept" }),
    );
    await push(event("identity.organization.invitation.accepted.v1", { invitationId: e }));

    // Noise: an unrelated event must not disturb any funnel.
    await push(
      makeEvent({
        eventType: "consent.receipt.recorded.v1",
        producer: "somnus-identity-service",
        correlationId: "corr-1",
        subject: { type: "user", id: opaqueId() },
        data: { purposeKey: "terms_acceptance" },
      }),
    );
  }

  it("reproduces the seeded registration funnel exactly, per role branch", async () => {
    await seed();
    const { registration } = buildFunnels(exporter.rows);

    expect(registration.started).toEqual({ adult: 3, parent: 2, professional: 4 });
    expect(registration.completed).toEqual({ adult: 3, parent: 1, professional: 2 });
  });

  it("reproduces the seeded verification funnel, with the median time to decision", async () => {
    await seed();
    const { verification } = buildFunnels(exporter.rows);

    expect(verification).toEqual({
      opened: 3,
      approved: 2,
      rejected: 1,
      medianTimeToDecisionMs: 3000,
    });
  });

  it("reproduces the seeded invitation funnel, counting invitations not page loads", async () => {
    await seed();
    const { invitation } = buildFunnels(exporter.rows);

    expect(invitation).toEqual({
      issued: 5,
      previewed: 3,
      accepted: 2,
      expired: 2,
      previewViews: 5,
    });
  });

  it("does not double-count a redelivered event", async () => {
    const duplicate = event("identity.registration.completed.v1", { roleBranch: "adult" });
    await service.record(duplicate);
    await service.record(duplicate);
    await service.record(duplicate);

    // The store deduped by event id, so only one row was ever exported.
    expect(exporter.rows).toHaveLength(1);
    expect(buildFunnels(exporter.rows).registration.completed.adult).toBe(1);
  });

  it("does not drop events: every seeded analytics event reaches the export", async () => {
    await seed();

    // Registration 15 (adult 3+3, parent 2+1, professional 4+2)
    // + 3 requested + 3 decided
    // + 5 created + 5 previewed + 2 accepted + 3 expired
    // = 36 analytics events, plus the 1 consent event = 37 exported rows.
    expect(exporter.rows).toHaveLength(37);
    const analytics = exporter.rows.filter((r) =>
      (ANALYTICS_EVENT_TYPES as ReadonlyArray<string>).includes(r.eventType),
    );
    expect(analytics).toHaveLength(36);
  });

  it("exports no personal data at all across the whole seeded run", async () => {
    await seed();

    for (const row of exporter.rows) {
      expect(row).not.toHaveProperty("actorId");
      expect(row).not.toHaveProperty("subjectId");
      for (const key of Object.keys(row.data)) {
        expect(FORBIDDEN_ANALYTICS_FIELDS).not.toContain(key.toLowerCase());
      }
    }
  });
});

describe("funnel edge cases", () => {
  function row(eventType: string, data: Record<string, unknown>): AuditExportRow {
    return {
      eventId: opaqueId(),
      eventType,
      occurredAt: "2026-09-05T12:00:00.000Z",
      producer: "somnus-identity-service",
      correlationId: "corr-1",
      actorType: null,
      subjectType: "thing",
      data,
    };
  }

  it("has no median before anything has been decided (the state until Checkpoint 15.2)", () => {
    const funnels = buildFunnels([
      row("identity.professional.verification.requested.v1", { caseId: opaqueId() }),
    ]);
    expect(funnels.verification.opened).toBe(1);
    expect(funnels.verification.medianTimeToDecisionMs).toBeNull();
  });

  it("averages the two middle values for an even number of decisions", () => {
    const decided = (ms: number) =>
      row("identity.professional.verification.decided.v1", {
        caseId: opaqueId(),
        decision: "approved",
        timeToDecisionMs: ms,
      });

    // [100, 200, 300, 400] -> (200 + 300) / 2
    const funnels = buildFunnels([decided(300), decided(100), decided(400), decided(200)]);
    expect(funnels.verification.medianTimeToDecisionMs).toBe(250);
  });

  it("ignores a row whose funnel key is missing rather than counting a phantom", () => {
    const funnels = buildFunnels([
      row("identity.registration.started.v1", {}),
      row("identity.registration.completed.v1", { roleBranch: "not-a-branch" }),
      row("identity.professional.verification.requested.v1", {}),
      row("identity.organization.invitation.created.v1", {}),
      row("identity.organization.invitation.previewed.v1", {}),
      row("identity.organization.invitation.accepted.v1", {}),
      row("identity.organization.invitation.expired.v1", { stage: "preview" }),
      row("identity.professional.verification.decided.v1", { decision: "approved" }),
    ]);

    expect(funnels.registration).toEqual({
      started: { adult: 0, parent: 0, professional: 0 },
      completed: { adult: 0, parent: 0, professional: 0 },
    });
    expect(funnels.verification).toEqual({
      opened: 0,
      approved: 0,
      rejected: 0,
      medianTimeToDecisionMs: null,
    });
    expect(funnels.invitation).toEqual({
      issued: 0,
      previewed: 0,
      accepted: 0,
      expired: 0,
      previewViews: 0,
    });
  });

  it("returns empty funnels for no rows at all", () => {
    const funnels = buildFunnels([]);
    expect(funnels.registration.started).toEqual({ adult: 0, parent: 0, professional: 0 });
    expect(funnels.invitation.issued).toBe(0);
  });
});
