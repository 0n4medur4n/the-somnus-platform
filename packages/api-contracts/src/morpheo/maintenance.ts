import { z } from "zod";

/**
 * Retention/cleanup boundary (build plan §20 Checkpoint 12.2). The worker's
 * scheduled jobs call Morpheo to purge rows older than a cutoff: unclaimed
 * assessments (30-day TTL) and expired claim tokens (72 h). TS↔Python boundary, so
 * the Zod schema is the source of truth and drift-guards both sides.
 */
export const MaintenanceDeleteRequestSchema = z
  .object({
    // Delete rows created strictly before this instant; the worker computes it
    // from its clock (now - TTL), so the TTL is time-controllable in tests.
    before: z.string().datetime(),
  })
  .strict();
export type MaintenanceDeleteRequest = z.infer<typeof MaintenanceDeleteRequestSchema>;

export const MaintenanceDeleteResultSchema = z
  .object({
    deleted: z.number().int().min(0),
  })
  .strict();
export type MaintenanceDeleteResult = z.infer<typeof MaintenanceDeleteResultSchema>;

/**
 * Account deletion (build plan §21 / Checkpoint 13.2, right to erasure): delete
 * every assessment a given user claimed. The edge orchestrates this as part of
 * deleting the account; Morpheo owns and erases its own data (§7).
 */
export const AccountAssessmentsDeleteRequestSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();
export type AccountAssessmentsDeleteRequest = z.infer<
  typeof AccountAssessmentsDeleteRequestSchema
>;
