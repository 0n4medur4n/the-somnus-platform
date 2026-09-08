import { type AnalyticsEventType, MORPHEO_ROLES, type RoleBranch } from "@somnus/api-contracts";
import type { AuditExportRow } from "./audit-exporter.js";

/**
 * The funnel definitions behind the Phase 15 statistics dashboards
 * (Addendum A §A2.4 / Checkpoint 14.3).
 *
 * This is a pure projection over the **exported** rows, not over the audit
 * store: whatever the dashboard can compute, it computes from exactly the rows
 * that reach BigQuery, so a field redaction can never silently change a metric
 * without also changing this function's output. It doubles as the executable
 * specification of the BigQuery queries Checkpoint 15.4 will write.
 *
 * Counting rules, chosen so a redelivery or a page reload cannot inflate a
 * number:
 *
 * - **Registration** counts events. Provisioning emits exactly one `started`
 *   and at most one `completed` per submitted attempt, and the audit store
 *   dedupes by event id, so the raw count is already the attempt count.
 * - **Verification** and **invitation** count DISTINCT entity ids per stage
 *   (`caseId`, `invitationId`). Previews and expiries can legitimately repeat
 *   for the same invitation -- someone reloading the accept screen -- and a
 *   funnel must not read that as extra invitations. The raw event counts stay
 *   available alongside for the stages where volume is itself interesting.
 *
 * The rows carry no actor or subject id (the exporter drops them), so
 * per-person metrics are deliberately impossible here.
 */

export type RegistrationFunnel = {
  /** Submitted registrations, by role branch. */
  started: Record<RoleBranch, number>;
  /** Successful registrations, by role branch. */
  completed: Record<RoleBranch, number>;
};

export type VerificationFunnel = {
  /** Distinct verification cases opened by a self-declared professional. */
  opened: number;
  approved: number;
  rejected: number;
  /**
   * "Median time to verification" (§A2.4), over decided cases only. `null` when
   * nothing has been decided yet -- which is the state until Checkpoint 15.2
   * ships the verifier queue.
   */
  medianTimeToDecisionMs: number | null;
};

export type InvitationFunnel = {
  /** Distinct invitations issued. */
  issued: number;
  /** Distinct invitations whose accept screen was opened at least once. */
  previewed: number;
  accepted: number;
  /** Distinct invitations that were refused for being past their deadline. */
  expired: number;
  /** Raw preview calls, including reloads. Volume, not conversion. */
  previewViews: number;
};

export type Funnels = {
  registration: RegistrationFunnel;
  verification: VerificationFunnel;
  invitation: InvitationFunnel;
};

function emptyByBranch(): Record<RoleBranch, number> {
  return Object.fromEntries(MORPHEO_ROLES.map((role) => [role, 0])) as Record<RoleBranch, number>;
}

function isRoleBranch(value: unknown): value is RoleBranch {
  return typeof value === "string" && (MORPHEO_ROLES as ReadonlyArray<string>).includes(value);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return (low + high) / 2;
}

/** Rows are already redacted; `data` holds only contract-declared fields. */
function stringField(row: AuditExportRow, key: string): string | null {
  const value = row.data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildFunnels(rows: readonly AuditExportRow[]): Funnels {
  const registration: RegistrationFunnel = {
    started: emptyByBranch(),
    completed: emptyByBranch(),
  };

  const casesOpened = new Set<string>();
  const casesApproved = new Set<string>();
  const casesRejected = new Set<string>();
  const decisionTimes: number[] = [];

  const invitationsIssued = new Set<string>();
  const invitationsPreviewed = new Set<string>();
  const invitationsAccepted = new Set<string>();
  const invitationsExpired = new Set<string>();
  let previewViews = 0;

  for (const row of rows) {
    const eventType = row.eventType as AnalyticsEventType;

    switch (eventType) {
      case "identity.registration.started.v1": {
        const branch = row.data["roleBranch"];
        if (isRoleBranch(branch)) registration.started[branch] += 1;
        break;
      }
      case "identity.registration.completed.v1": {
        const branch = row.data["roleBranch"];
        if (isRoleBranch(branch)) registration.completed[branch] += 1;
        break;
      }
      case "identity.professional.verification.requested.v1": {
        const caseId = stringField(row, "caseId");
        if (caseId) casesOpened.add(caseId);
        break;
      }
      case "identity.professional.verification.decided.v1": {
        const caseId = stringField(row, "caseId");
        if (!caseId) break;
        if (row.data["decision"] === "approved") casesApproved.add(caseId);
        if (row.data["decision"] === "rejected") casesRejected.add(caseId);
        const elapsed = row.data["timeToDecisionMs"];
        if (typeof elapsed === "number" && Number.isFinite(elapsed)) decisionTimes.push(elapsed);
        break;
      }
      case "identity.organization.invitation.created.v1": {
        const id = stringField(row, "invitationId");
        if (id) invitationsIssued.add(id);
        break;
      }
      case "identity.organization.invitation.previewed.v1": {
        const id = stringField(row, "invitationId");
        if (id) {
          invitationsPreviewed.add(id);
          previewViews += 1;
        }
        break;
      }
      case "identity.organization.invitation.accepted.v1": {
        const id = stringField(row, "invitationId");
        if (id) invitationsAccepted.add(id);
        break;
      }
      case "identity.organization.invitation.expired.v1": {
        const id = stringField(row, "invitationId");
        if (id) invitationsExpired.add(id);
        break;
      }
      default:
        // Not a funnel event (consent, morpheo, report, ...): ignored here.
        break;
    }
  }

  return {
    registration,
    verification: {
      opened: casesOpened.size,
      approved: casesApproved.size,
      rejected: casesRejected.size,
      medianTimeToDecisionMs: median(decisionTimes),
    },
    invitation: {
      issued: invitationsIssued.size,
      previewed: invitationsPreviewed.size,
      accepted: invitationsAccepted.size,
      expired: invitationsExpired.size,
      previewViews,
    },
  };
}
