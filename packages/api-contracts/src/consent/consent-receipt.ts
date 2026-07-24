import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";
import { ConsentPurposeKeySchema } from "./consent-purpose.js";

export const ConsentReceiptSchema = z.object({
  id: opaqueIdSchema,
  userId: opaqueIdSchema,
  purposeKey: ConsentPurposeKeySchema,
  legalDocumentVersionId: opaqueIdSchema,
  organizationId: opaqueIdSchema.optional(),
  source: z.string().min(1).max(120),
  consentedAt: z.iso.datetime(),
  withdrawnAt: z.iso.datetime().optional(),
});
export type ConsentReceipt = z.infer<typeof ConsentReceiptSchema>;

/** POST /v1/consents -- always grants against the CURRENT document version for the purpose; the version is never client-chosen. */
export const ConsentCreateRequestSchema = z
  .object({
    purposeKey: ConsentPurposeKeySchema,
    organizationId: opaqueIdSchema.optional(),
    source: z.string().min(1).max(120).default("app"),
  })
  .strict();
export type ConsentCreateRequest = z.infer<typeof ConsentCreateRequestSchema>;

/** POST /v1/consents/:id/withdraw */
export const ConsentWithdrawRequestSchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type ConsentWithdrawRequest = z.infer<typeof ConsentWithdrawRequestSchema>;

/**
 * One row per purpose, describing the actor's current standing.
 * `consented`: the latest receipt for this purpose has not been
 * withdrawn. `current`: that receipt was granted against the document
 * version that is still the latest published one (version
 * supersession -- publishing a new version does not retroactively
 * withdraw consent, it just stops counting as "current").
 * `withdrawn`: the latest receipt for this purpose was explicitly
 * withdrawn -- the only field build plan §11's authorization policy
 * (DENIED_CONSENT_WITHDRAWN) actually consults.
 */
export const ConsentStatusSchema = z.object({
  purposeKey: ConsentPurposeKeySchema,
  consented: z.boolean(),
  current: z.boolean(),
  withdrawn: z.boolean(),
  receiptId: opaqueIdSchema.optional(),
  legalDocumentVersionId: opaqueIdSchema.optional(),
  consentedAt: z.iso.datetime().optional(),
});
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

/** GET /v1/consents/current */
export const ConsentStatusListResponseSchema = z.object({
  purposes: z.array(ConsentStatusSchema),
});
export type ConsentStatusListResponse = z.infer<typeof ConsentStatusListResponseSchema>;
