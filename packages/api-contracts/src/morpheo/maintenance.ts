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
