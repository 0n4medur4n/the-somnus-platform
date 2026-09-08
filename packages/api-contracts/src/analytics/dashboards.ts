import { z } from "zod";
import { MORPHEO_ROLES } from "../morpheo/enums.js";

/**
 * The Phase 15 statistics dashboards and audit log viewer (Addendum A §A2.4 /
 * Checkpoint 15.4).
 *
 * The dashboard shape mirrors the worker's projection over the BigQuery export
 * (`audit/export/dashboards.ts`), which is the executable specification of the
 * queries. Nothing here is per-person: the export drops actor and subject ids
 * before anything leaves the worker, so aggregate is not a policy applied on top
 * of these shapes, it is the only thing they can carry.
 */

const byRoleBranch = z.record(z.enum(MORPHEO_ROLES), z.number().int().nonnegative());

export const RegistrationFunnelSchema = z
  .object({ started: byRoleBranch, completed: byRoleBranch })
  .strict();

export const VerificationFunnelSchema = z
  .object({
    opened: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    /** Null until something has been decided; §A2.4's "median time to verification". */
    medianTimeToDecisionMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const InvitationFunnelSchema = z
  .object({
    issued: z.number().int().nonnegative(),
    previewed: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    /** Raw preview calls including reloads: volume, not conversion. */
    previewViews: z.number().int().nonnegative(),
  })
  .strict();

/**
 * A §A2.4 metric nothing currently measures, with the reason.
 *
 * Carried to the console as data rather than left out, so the screen can show a
 * declared gap instead of a number. A zero is a measurement; rendering one where
 * no event exists would tell an operator the platform is idle when the truth is
 * that nobody is counting.
 */
export const UnavailableMetricSchema = z
  .object({ metric: z.string().min(1), reason: z.string().min(1) })
  .strict();
export type UnavailableMetric = z.infer<typeof UnavailableMetricSchema>;

export const DashboardCountsSchema = z
  .object({
    assessmentsStarted: z.number().int().nonnegative(),
    assessmentsCompleted: z.number().int().nonnegative(),
    reportsRequested: z.number().int().nonnegative(),
    reportsGenerated: z.number().int().nonnegative(),
    notificationsRequested: z.number().int().nonnegative(),
    organizationsCreated: z.number().int().nonnegative(),
  })
  .strict();

export const DashboardsSchema = z
  .object({
    funnels: z
      .object({
        registration: RegistrationFunnelSchema,
        verification: VerificationFunnelSchema,
        invitation: InvitationFunnelSchema,
      })
      .strict(),
    counts: DashboardCountsSchema,
    /**
     * Break-glass accesses per admin. Wired now and empty until Checkpoint 15.5
     * builds the feature, so the dashboard's shape does not change when it lands.
     */
    breakGlassByAdmin: z.record(z.string(), z.number().int().nonnegative()),
    unavailable: z.array(UnavailableMetricSchema),
    rowsConsidered: z.number().int().nonnegative(),
    /** True when the read hit its cap: the numbers are a lower bound, not a total. */
    truncated: z.boolean(),
    /** The span the numbers cover, or null when there is nothing to show. */
    window: z.object({ from: z.string(), to: z.string() }).strict().nullable(),
  })
  .strict();
export type Dashboards = z.infer<typeof DashboardsSchema>;

// --- Audit log viewer -------------------------------------------------------

/**
 * One audit row as the viewer may render it.
 *
 * `.strict()` is doing real work: it is the contract-level half of the worker's
 * allowlist projection, so a column added to `audit_records` cannot reach the
 * console even if some future handler forgets to project it away.
 *
 * `actorId` and `subjectId` travel here although the BigQuery export drops them.
 * That asymmetry is deliberate — §A2.4 requires filtering by actor, and an audit
 * log that cannot say who did what to whom is not an audit log. Both are opaque
 * ids, never names or addresses.
 */
export const AuditViewRowSchema = z
  .object({
    eventId: z.string(),
    eventType: z.string(),
    occurredAt: z.string(),
    receivedAt: z.string(),
    producer: z.string(),
    correlationId: z.string(),
    actorType: z.string().nullable(),
    actorId: z.string().nullable(),
    subjectType: z.string(),
    subjectId: z.string(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AuditViewRow = z.infer<typeof AuditViewRowSchema>;

export const AuditViewPageSchema = z.object({ rows: z.array(AuditViewRowSchema) }).strict();
export type AuditViewPage = z.infer<typeof AuditViewPageSchema>;

/** §A2.4's four filters. All optional, all narrowing. */
export const AuditQueryRequestSchema = z
  .object({
    actorId: z.string().min(1).max(200).optional(),
    /** The entity kind an action was about. */
    subjectType: z.string().min(1).max(64).optional(),
    /** The action, i.e. the event type. */
    eventType: z.string().min(1).max(120).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type AuditQueryRequest = z.infer<typeof AuditQueryRequestSchema>;
