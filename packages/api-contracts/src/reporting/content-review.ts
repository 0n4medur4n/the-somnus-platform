import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

/**
 * The AI content review queue (Checkpoint 15.3, build plan §15).
 *
 * The report service owns `ai_content_review_items` in `somnus_reporting`; these
 * are the shapes it puts on the wire and the admin console renders. The Python
 * mirror is `report.schemas.content_review`.
 *
 * §15 requires human review before AI health text is released, and requires
 * logging the model, the template version, and the input/output hashes per
 * generation. Both hashes travel with the item so an approval can be tied back to
 * exactly which generation a named reviewer accepted.
 */

/** Only `approved` is ever renderable; the other two have no route out. */
export const CONTENT_REVIEW_STATUSES = ["pending_review", "approved", "rejected"] as const;
export const ContentReviewStatusSchema = z.enum(CONTENT_REVIEW_STATUSES);
export type ContentReviewStatus = z.infer<typeof ContentReviewStatusSchema>;

export const ContentReviewItemSchema = z
  .object({
    itemId: z.string().min(1).max(32),
    reportId: z.string().min(1).max(32),
    promptTemplateVersion: z.string().min(1).max(32),
    modelId: z.string().min(1).max(64),
    /** sha256 hex of the structured input and of the model's response (§15). */
    inputHash: z.string().length(64),
    outputHash: z.string().length(64),
    /**
     * The approved prose the candidate was reworded from, and the candidate
     * itself. Both travel because the reviewer's whole job is to compare them
     * (Addendum A §A2.1/§A4): a hash cannot be shown to a human.
     */
    deterministicText: z.string(),
    candidateText: z.string(),
    status: ContentReviewStatusSchema,
    /** Null until decided. Set together, and never rewritten afterwards. */
    reviewerId: opaqueIdSchema.nullable(),
    decidedAt: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ContentReviewItem = z.infer<typeof ContentReviewItemSchema>;

export const ContentReviewQueueSchema = z.object({ items: z.array(ContentReviewItemSchema) });
export type ContentReviewQueue = z.infer<typeof ContentReviewQueueSchema>;

export const ContentReviewDecisionRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /**
     * Required in both directions, exactly as
     * AdminVerificationDecisionRequestSchema requires it (Checkpoint 15.2). An
     * approval that released AI-written health text with no recorded reason is
     * precisely what an audit needs to be able to question later.
     */
    reason: z.string().min(3).max(500),
  })
  .strict();
export type ContentReviewDecisionRequest = z.infer<typeof ContentReviewDecisionRequestSchema>;
