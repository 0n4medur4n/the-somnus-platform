import { AuditQueryRequestSchema, EventEnvelopeSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** An audit event envelope (§17), validated by the global nestjs-zod pipe. */
export class AuditEventDto extends createZodDto(EventEnvelopeSchema) {}

/** The audit log viewer's four filters (§A2.4 / Checkpoint 15.4). */
export class AuditQueryDto extends createZodDto(AuditQueryRequestSchema) {}

/**
 * The dashboard window. Both ends optional: no window means everything the cap
 * allows, and the response says whether that cap was reached.
 */
export const DashboardWindowSchema = z
  .object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() })
  .strict();
export class DashboardWindowDto extends createZodDto(DashboardWindowSchema) {}
