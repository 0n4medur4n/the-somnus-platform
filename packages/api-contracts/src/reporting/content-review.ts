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

/**
 * What grounded the report a candidate paraphrases (Addendum B §B5, 16.5).
 *
 * The citations come straight from the immutable record stamped at generation.
 * The documents are resolved at read time against the corpus as it was at that
 * `corpusVersion`, which is why `retiredSince` can be true: the material is still
 * what grounded this report, and is no longer what would ground a new one.
 */
export const ProvenanceCitationSchema = z
  .object({
    sourceId: z.string(),
    citation: z.string(),
    url: z.string(),
    /** "rule" when the fired rule named it, "similarity" for the fallback. */
    resolvedBy: z.string(),
  })
  .strict();
export type ProvenanceCitation = z.infer<typeof ProvenanceCitationSchema>;

export const ProvenanceDocumentSchema = z
  .object({
    documentId: z.string(),
    title: z.string(),
    citation: z.string(),
    locale: z.string(),
    corpusVersionAdded: z.number().int().nullish(),
    retiredSince: z.boolean(),
  })
  .strict();
export type ProvenanceDocument = z.infer<typeof ProvenanceDocumentSchema>;

export const ReportProvenanceSchema = z
  .object({
    /** 0 is a real answer: nothing had been published when the report was made. */
    corpusVersion: z.number().int().nonnegative(),
    contentVersion: z.string(),
    citations: z.array(ProvenanceCitationSchema),
    documents: z.array(ProvenanceDocumentSchema),
  })
  .strict();
export type ReportProvenance = z.infer<typeof ReportProvenanceSchema>;

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
    /**
     * Checkpoint 16.5. Null when the report recorded none — which is different
     * from an empty one, and a reviewer should be able to tell the two apart:
     * "nothing grounded this beyond the artifact" is not "we did not record what
     * did". `.nullish()` because the provider is Pydantic and serializes an
     * unset optional as an explicit null.
     */
    provenance: ReportProvenanceSchema.nullish(),
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
