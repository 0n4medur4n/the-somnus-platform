import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";
import { ConsentPurposeKeySchema } from "./consent-purpose.js";

/**
 * POST /internal/v1/consents/check -- the sole cross-module entry
 * point. `AuthorizationService` (in domain/authorization) calls this
 * through `ConsentService`, never by querying consent's tables
 * directly (build plan ADR 0010: identity reaches consent only
 * through the module's public interface).
 */
export const ConsentCheckRequestSchema = z
  .object({
    userId: opaqueIdSchema,
    purposeKey: ConsentPurposeKeySchema,
  })
  .strict();
export type ConsentCheckRequest = z.infer<typeof ConsentCheckRequestSchema>;

export const ConsentCheckResponseSchema = z.object({
  consented: z.boolean(),
  withdrawn: z.boolean(),
});
export type ConsentCheckResponse = z.infer<typeof ConsentCheckResponseSchema>;
