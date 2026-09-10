import { z } from "zod";
import { UserAssessmentSnapshotSchema } from "../morpheo/assessment.js";
import { opaqueIdSchema } from "../uuid.js";

/**
 * Break-glass access to an individual's clinical answers and results
 * (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * The point of §A2.3 is that administrative access and clinical access are
 * different things: "full access" for a platform admin means every user, every
 * organization, every statistic and every log — it does not mean default
 * visibility of one person's health answers. Break-glass is the deliberate,
 * recorded exception, and every element of it is in this contract so no screen
 * or service can soften it locally.
 *
 * Three properties the shapes below enforce rather than merely describe:
 *
 * * There is no reveal request without a justification and a category. They are
 *   required fields of the only request schema the route accepts, so "reveal
 *   first, explain later" is not a state the API can be in.
 * * There is no unlock. The response carries the records once; nothing in it
 *   grants anything, and there is no token, flag or session field to carry
 *   forward. Seeing the data again means submitting a justification again.
 * * The justification never enters the analytics export. It is free text a human
 *   typed (§9 forbids that in BigQuery), so `somnus_audit` keeps it in a column
 *   of its own and the export row's shape simply has no such field.
 */

/**
 * Why the record is being opened. §A2.3 names these four exactly.
 *
 * A closed set rather than free text because this is the dimension the
 * statistics dashboard and any later review will group by; "other" exists so
 * nobody has to mislabel an access to get past the form, and the free-text
 * justification is where the real reason goes.
 */
export const BREAK_GLASS_CATEGORIES = ["support", "safety", "legal", "other"] as const;
export const BreakGlassCategorySchema = z.enum(BREAK_GLASS_CATEGORIES);
export type BreakGlassCategory = z.infer<typeof BreakGlassCategorySchema>;

/**
 * The minimum §A2.3 asks for, made a number.
 *
 * Long enough that a word cannot satisfy it — "support", "asked", "check" all
 * fail — because a justification nobody can read is the same as no justification
 * at all, and this text is what a later reviewer has to judge the access by. The
 * ceiling matches the review reasons in Checkpoint 15.3: an audit column is not
 * a place to paste a case file.
 */
export const BREAK_GLASS_JUSTIFICATION_MIN_LENGTH = 20;
export const BREAK_GLASS_JUSTIFICATION_MAX_LENGTH = 500;

/** Trimmed before measuring, so twenty spaces is not a justification. */
export const BreakGlassJustificationSchema = z
  .string()
  .trim()
  .min(BREAK_GLASS_JUSTIFICATION_MIN_LENGTH)
  .max(BREAK_GLASS_JUSTIFICATION_MAX_LENGTH);

/**
 * `POST /admin/v1/break-glass/reveal` — the only way in.
 *
 * `.strict()` matters here beyond tidiness: it means no caller can add a field
 * that some future handler might read as a bypass.
 */
export const BreakGlassRevealRequestSchema = z
  .object({
    /** The person whose clinical record is being opened. */
    subjectUserId: opaqueIdSchema,
    category: BreakGlassCategorySchema,
    justification: BreakGlassJustificationSchema,
  })
  .strict();
export type BreakGlassRevealRequest = z.infer<typeof BreakGlassRevealRequestSchema>;

/**
 * What comes back, for this response and no longer.
 *
 * `revealedAt` is here so the screen can say when the reveal happened rather
 * than implying the data is live, and so what the admin sees and what the audit
 * record says can be compared by eye.
 */
export const BreakGlassRevealResponseSchema = z
  .object({
    subjectUserId: opaqueIdSchema,
    revealedAt: z.iso.datetime(),
    /** The audit event this reveal wrote. Named so the access can be looked up. */
    auditEventId: z.string().min(1),
    snapshots: z.array(UserAssessmentSnapshotSchema),
  })
  .strict();
export type BreakGlassRevealResponse = z.infer<typeof BreakGlassRevealResponseSchema>;

/**
 * The event type the reveal records (§17 vocabulary, §A2.3 point 3).
 *
 * Deliberately NOT a registered analytics event. Analytics payloads are parsed
 * with a `.strict()` allowlist before export, which would mean the whole payload
 * is discarded the moment it carries anything beyond the declared fields — and
 * this event's stored `data` is read by the audit viewer as well as counted by
 * the dashboard. It goes through the ordinary denylist regime instead, carrying
 * only two keys, both safe to export.
 */
export const BREAK_GLASS_EVENT_TYPE = "admin.break_glass.accessed.v1";

/**
 * The `data` payload of that event.
 *
 * `adminId` duplicates the envelope's actor on purpose: the analytics export
 * drops actor ids before anything leaves the worker, so a per-admin count
 * (§A2.3 point 4 — "so abuse is visible, not hidden") can only be computed from
 * a field inside `data`. It is an opaque internal-staff id, never a name, never
 * an address, and never the subject's.
 *
 * The justification is absent by design, and the subject's id with it: the
 * record being opened is the envelope's `subject`, which the export also drops.
 */
export const BreakGlassEventDataSchema = z
  .object({
    adminId: opaqueIdSchema,
    category: BreakGlassCategorySchema,
  })
  .strict();
export type BreakGlassEventData = z.infer<typeof BreakGlassEventDataSchema>;
