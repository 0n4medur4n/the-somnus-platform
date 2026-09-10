import { BREAK_GLASS_EVENT_TYPE, type EventEnvelope, opaqueId } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import { AuditService, liftJustification } from "../src/modules/audit/audit.service.js";
import type {
  AuditRecordInput,
  AuditRow,
  AuditStore,
} from "../src/modules/audit/db/repositories/index.js";
import type { AuditExportRow } from "../src/modules/audit/export/audit-exporter.js";
import { redactForExport } from "../src/modules/audit/export/audit-exporter.js";
import {
  AUDIT_VIEW_FIELDS,
  toAuditViewRow,
  toCsv,
} from "../src/modules/audit/export/audit-view.js";
import { projectDashboards } from "../src/modules/audit/export/dashboards.js";

/**
 * Break-glass access, on the worker's side (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * Two properties are asserted here, and they pull in opposite directions, which
 * is why the justification lives in a column rather than in the event payload:
 *
 * * The audit viewer MUST show the written reason. An access nobody can judge
 *   after the fact is not an audited access.
 * * BigQuery must NEVER receive it. It is free text a human typed, and §9 does
 *   not admit free text to the warehouse on any terms.
 *
 * The second is asserted structurally rather than by inspecting one row: the
 * export row shape has no such field, so the test hands `redactForExport` a
 * record that DOES carry a justification and then checks the whole serialized
 * row, not a named key.
 */

const ADMIN_A = opaqueId();
const ADMIN_B = opaqueId();

function exportRow(over: Partial<AuditExportRow> = {}): AuditExportRow {
  return {
    eventId: opaqueId(),
    eventType: BREAK_GLASS_EVENT_TYPE,
    occurredAt: "2026-09-04T09:00:00Z",
    producer: "somnus-edge-api",
    correlationId: "corr-1",
    actorType: "admin",
    subjectType: "user",
    data: { adminId: ADMIN_A, category: "support" },
    ...over,
  };
}

function envelope(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: opaqueId(),
    eventType: BREAK_GLASS_EVENT_TYPE,
    occurredAt: "2026-09-04T09:00:00Z",
    producer: "somnus-edge-api",
    correlationId: "corr-1",
    actor: { type: "admin", id: ADMIN_A },
    subject: { type: "user", id: "subject-1" },
    data: {
      adminId: ADMIN_A,
      category: "safety",
      justification: "Safeguarding escalation raised by the on-call clinician this morning.",
    },
    ...over,
  };
}

class FakeStore implements AuditStore {
  created: AuditRecordInput[] = [];
  async findByEventId(): Promise<AuditRow | null> {
    return null;
  }
  async create(input: AuditRecordInput): Promise<string> {
    this.created.push(input);
    return `a-${this.created.length}`;
  }
  /** Everything recorded, as the real store would hand it back. */
  private rows(): AuditRow[] {
    return this.created.map((input, index) => ({
      id: `a-${index + 1}`,
      ...input,
      data: input.data as AuditRow["data"],
      receivedAt: new Date(input.occurredAt),
    }));
  }
  async query(): Promise<AuditRow[]> {
    return this.rows();
  }
  async listWindow(): Promise<AuditRow[]> {
    return this.rows();
  }
}

class FakeExporter {
  rows: AuditExportRow[] = [];
  async export(row: AuditExportRow): Promise<void> {
    this.rows.push(row);
  }
}

describe("the justification is lifted out of the event payload", () => {
  it("moves the text into its own field and leaves `data` without it", () => {
    const { justification, data } = liftJustification({
      adminId: ADMIN_A,
      category: "legal",
      justification: "  Subject access request received from the family's solicitor.  ",
    });

    expect(justification).toBe("Subject access request received from the family's solicitor.");
    expect(data).toEqual({ adminId: ADMIN_A, category: "legal" });
    expect(Object.keys(data)).not.toContain("justification");
  });

  it("leaves an ordinary payload alone", () => {
    const { justification, data } = liftJustification({ roleBranch: "adult" });
    expect(justification).toBeNull();
    expect(data).toEqual({ roleBranch: "adult" });
  });

  it("removes a non-string value under that key rather than storing it", () => {
    // Whatever it is, it is not a justification, and `data` should not carry
    // free-form content under that name on the strength of having a odd type.
    const { justification, data } = liftJustification({ justification: { nested: "text" } });
    expect(justification).toBeNull();
    expect(data).toEqual({});
  });

  it("treats whitespace as no justification at all", () => {
    expect(liftJustification({ justification: "     " }).justification).toBeNull();
  });
});

describe("recording a break-glass access", () => {
  it("stores the reason in its own field, never in `data`", async () => {
    const store = new FakeStore();
    await new AuditService(store, new FakeExporter()).record(envelope());

    const record = store.created[0];
    expect(record?.justification).toBe(
      "Safeguarding escalation raised by the on-call clinician this morning.",
    );
    expect(record?.data).toEqual({ adminId: ADMIN_A, category: "safety" });
    expect(record?.subjectId).toBe("subject-1");
    expect(record?.actorId).toBe(ADMIN_A);
  });

  it("exports a row that cannot carry the reason at all", async () => {
    const exporter = new FakeExporter();
    await new AuditService(new FakeStore(), exporter).record(envelope());

    const row = exporter.rows[0];
    expect(row).toBeDefined();
    // Not `expect(row.justification).toBeUndefined()` -- the point is that no
    // field of the export row holds the text, whatever it might be called.
    expect(JSON.stringify(row)).not.toContain("Safeguarding escalation");
    // The two things it does carry, and nothing identifying beyond the admin.
    expect(row?.data).toEqual({ adminId: ADMIN_A, category: "safety" });
    expect(row).not.toHaveProperty("actorId");
    expect(row).not.toHaveProperty("subjectId");
  });

  it("drops the reason even when a record reaches the exporter carrying one", () => {
    // The structural guarantee, exercised directly: `redactForExport` builds a
    // fixed shape, so a stored justification has nowhere to go.
    const exported = redactForExport({
      eventId: opaqueId(),
      eventType: BREAK_GLASS_EVENT_TYPE,
      occurredAt: "2026-09-04T09:00:00Z",
      producer: "somnus-edge-api",
      correlationId: "corr-1",
      actorType: "admin",
      actorId: ADMIN_A,
      subjectType: "user",
      subjectId: "subject-1",
      data: { adminId: ADMIN_A, category: "support" },
      justification: "Never leaves the service.",
    });

    expect(JSON.stringify(exported)).not.toContain("Never leaves");
  });
});

describe("the audit viewer shows the access and its reason", () => {
  it("projects the justification through the allowlist", () => {
    const view = toAuditViewRow({
      eventId: "e1",
      eventType: BREAK_GLASS_EVENT_TYPE,
      occurredAt: "2026-09-04T09:00:00Z",
      receivedAt: "2026-09-04T09:00:01Z",
      producer: "somnus-edge-api",
      correlationId: "corr-1",
      actorType: "admin",
      actorId: ADMIN_A,
      subjectType: "user",
      subjectId: "subject-1",
      data: { adminId: ADMIN_A, category: "safety" },
      justification: "Safeguarding escalation raised by the on-call clinician.",
    });

    // §A4 asks for category, justification AND the record id -- not a generic
    // "accessed" flag. All three, from one row.
    expect(view.justification).toBe("Safeguarding escalation raised by the on-call clinician.");
    expect(view.data["category"]).toBe("safety");
    expect(view.subjectId).toBe("subject-1");
    expect(view.actorId).toBe(ADMIN_A);
  });

  it("is null on rows that are not a break-glass access", () => {
    expect(
      toAuditViewRow({ eventType: "identity.registration.completed.v1" }).justification,
    ).toBeNull();
  });

  it("carries the column into the CSV export, from the same allowlist", () => {
    expect(AUDIT_VIEW_FIELDS).toContain("justification");
    const csv = toCsv([
      toAuditViewRow({
        eventType: BREAK_GLASS_EVENT_TYPE,
        justification: "Support escalation, ticket 4471.",
      }),
    ]);
    expect(csv.split("\n")[0]).toContain("justification");
    expect(csv).toContain("Support escalation, ticket 4471.");
  });
});

describe("the dashboard counter is real (Checkpoint 15.5, same projection as 15.4)", () => {
  it("counts per admin and per calendar month", () => {
    const dashboards = projectDashboards([
      exportRow({ occurredAt: "2026-08-30T23:00:00Z" }),
      exportRow({ occurredAt: "2026-09-04T09:00:00Z" }),
      exportRow({ occurredAt: "2026-09-19T16:00:00Z" }),
      exportRow({
        occurredAt: "2026-09-20T08:00:00Z",
        data: { adminId: ADMIN_B, category: "legal" },
      }),
      // Not a break-glass access: must not be counted by it.
      exportRow({ eventType: "admin.user.viewed.v1", data: {} }),
    ]);

    expect(dashboards.breakGlassByAdmin).toEqual({
      [ADMIN_A]: { "2026-08": 1, "2026-09": 2 },
      [ADMIN_B]: { "2026-09": 1 },
    });
  });

  it("is empty, not absent, when nobody has used it", () => {
    expect(
      projectDashboards([exportRow({ eventType: "admin.user.viewed.v1", data: {} })])
        .breakGlassByAdmin,
    ).toEqual({});
  });

  it("does not count a row whose payload fails the contract", () => {
    // A number counted from a malformed row is a number that means nothing.
    const dashboards = projectDashboards([
      exportRow({ data: { category: "support" } }),
      exportRow({ data: { adminId: ADMIN_A, category: "not-a-category" } }),
      exportRow({ data: {} }),
    ]);
    expect(dashboards.breakGlassByAdmin).toEqual({});
  });

  it("places the month in UTC, so a late-evening access does not drift", () => {
    const dashboards = projectDashboards([exportRow({ occurredAt: "2026-08-31T23:30:00Z" })]);
    expect(dashboards.breakGlassByAdmin[ADMIN_A]).toEqual({ "2026-08": 1 });
  });
});

/**
 * The exit criterion for Checkpoint 15.5, as one test.
 *
 * One access goes in, and the same access has to be findable in BOTH places
 * §A4 names -- the audit viewer and the dashboard counter -- without a second
 * store, a second projection, or a second write. Both reads below start from
 * the same recorded row and go through the code the console actually calls.
 */
describe("one break-glass access, end to end", () => {
  it("is visible in the audit viewer and in the dashboard counter", async () => {
    const store = new FakeStore();
    const service = new AuditService(store, new FakeExporter());

    await service.record(
      envelope({
        occurredAt: "2026-09-10T08:15:00Z",
        subject: { type: "user", id: "subject-42" },
        data: {
          adminId: ADMIN_A,
          category: "safety",
          justification: "Safeguarding escalation raised by the on-call clinician this morning.",
        },
      }),
    );

    const [viewed] = await service.query({});
    expect(viewed?.eventType).toBe(BREAK_GLASS_EVENT_TYPE);
    expect(viewed?.actorId).toBe(ADMIN_A);
    expect(viewed?.subjectId).toBe("subject-42");
    expect(viewed?.data["category"]).toBe("safety");
    expect(viewed?.justification).toContain("Safeguarding escalation");

    const dashboards = await service.dashboards();
    expect(dashboards.breakGlassByAdmin).toEqual({ [ADMIN_A]: { "2026-09": 1 } });

    // Same row, same count: the number on the dashboard and the line in the
    // viewer are the same access, not two arithmetics that happen to agree.
    expect(dashboards.rowsConsidered).toBe(1);
  });
});
