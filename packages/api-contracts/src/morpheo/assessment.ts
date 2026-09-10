import { z } from "zod";
import { AssessmentContentResponseSchema, ClinicalSourcesResponseSchema } from "./content.js";
import {
  AnswerKindSchema,
  BaseOrientationSchema,
  ClaimRejectReasonSchema,
  GateReasonSchema,
  ModuleIdSchema,
  RoleIdSchema,
  SafetyLevelIdSchema,
  TernaryValueSchema,
} from "./enums.js";
import {
  AccountAssessmentsDeleteRequestSchema,
  MaintenanceDeleteRequestSchema,
  MaintenanceDeleteResultSchema,
} from "./maintenance.js";

/**
 * The edge <-> morpheo assessment contract (build plan §20 Checkpoint 10.2,
 * "contract tests against edge"; §19 boundary edge <-> morpheo). Morpheo is a
 * private Cloud Run service; the edge BFF is the only caller. The flow is
 * anonymous (§14): no names, addresses, or identifiers cross this boundary —
 * only role, the minor's age band where relevant, and structured answers.
 *
 * These schemas are the single source of truth; the JSON Schema under
 * schemas/json-schema/morpheo/ is generated from them (never hand-written) and
 * validated on the Python provider side.
 */

/** edge -> morpheo: open an anonymous assessment session. */
export const AssessmentCreateRequestSchema = z
  .object({
    role: RoleIdSchema,
    consentGiven: z.boolean(),
    ageYears: z.number().int().min(0).max(120).nullable().optional(),
    guardianshipConfirmed: z.boolean().nullable().optional(),
    professionalConfirmed: z.boolean().nullable().optional(),
    containsIdentifiableData: z.boolean().optional(),
    baseOrientation: BaseOrientationSchema.optional(),
  })
  .strict();
export type AssessmentCreateRequest = z.infer<typeof AssessmentCreateRequestSchema>;

/** morpheo -> edge: the session id, or the gate reason it was blocked. */
export const AssessmentCreateResponseSchema = z
  .object({
    allowed: z.boolean(),
    sessionId: z.string().min(1).nullable(),
    reason: GateReasonSchema.nullable(),
  })
  .strict();
export type AssessmentCreateResponse = z.infer<typeof AssessmentCreateResponseSchema>;

/** edge -> morpheo: submit one validated answer (a complaint phrase or a signal). */
export const AnswerSubmitRequestSchema = z
  .object({
    kind: AnswerKindSchema,
    name: z.string().min(1).max(255),
    value: TernaryValueSchema.nullable().optional(),
  })
  .strict();
export type AnswerSubmitRequest = z.infer<typeof AnswerSubmitRequestSchema>;

/**
 * The deterministic result the engine produces (the summary response and the
 * frozen snapshot body). Mirrors morpheo's `AssessmentResult` exactly. Carries
 * only structured orientation — no free text, no answer collection (§17).
 */
export const AssessmentResultSchema = z
  .object({
    role: RoleIdSchema,
    level: SafetyLevelIdSchema.nullable(),
    stop: z.boolean(),
    privacyBlock: z.boolean(),
    routes: z.array(ModuleIdSchema),
    triggeredRules: z.array(z.string().min(1)),
    workflowVersion: z.string().min(1),
    contentVersion: z.string().min(1),
  })
  .strict();
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

/**
 * edge -> morpheo: claim an anonymous assessment. The single-use token comes
 * from the body; the authenticated user id is injected by the edge from the
 * session cookie (never sent by the client), so it is not part of this schema.
 */
export const AssessmentClaimRequestSchema = z
  .object({
    token: z.string().min(1).max(64),
  })
  .strict();
export type AssessmentClaimRequest = z.infer<typeof AssessmentClaimRequestSchema>;

/**
 * morpheo -> edge: a freshly minted single-use claim token (72 h). The edge
 * requests one when the anonymous user chooses to save a result, then carries
 * it through the authentication handoff so the authenticated user can claim.
 */
export const AssessmentClaimTokenResponseSchema = z
  .object({
    token: z.string().min(1).max(64),
  })
  .strict();
export type AssessmentClaimTokenResponse = z.infer<typeof AssessmentClaimTokenResponseSchema>;

/** morpheo -> edge: the frozen snapshot id, or the rejection reason. */
export const AssessmentClaimResponseSchema = z
  .object({
    success: z.boolean(),
    snapshotId: z.string().min(1).nullable(),
    reason: ClaimRejectReasonSchema.nullable(),
  })
  .strict();
export type AssessmentClaimResponse = z.infer<typeof AssessmentClaimResponseSchema>;

/** morpheo -> edge: the immutable snapshot fetched after a successful claim. */
export const AssessmentSnapshotResponseSchema = z
  .object({
    snapshotId: z.string().min(1),
    sessionId: z.string().min(1),
    result: AssessmentResultSchema,
    workflowVersion: z.string().min(1),
    contentVersion: z.string().min(1),
  })
  .strict();
export type AssessmentSnapshotResponse = z.infer<typeof AssessmentSnapshotResponseSchema>;

/**
 * edge -> morpheo: every assessment a given person claimed.
 *
 * Break-glass only (Addendum A §A2.3 / Checkpoint 15.5). Every other read of a
 * snapshot is actor-scoped -- the edge resolves the signed-in person and asks for
 * their own -- so this is the one route that returns a result to somebody who is
 * not its subject. It exists because an admin cannot exercise break-glass over a
 * record they have no way to name, and it is the only reason it exists.
 *
 * POST rather than GET so the person's id does not land in an access log, the
 * same reasoning the audit query uses.
 */
export const UserAssessmentsRequestSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();
export type UserAssessmentsRequest = z.infer<typeof UserAssessmentsRequestSchema>;

/**
 * One claimed assessment, as break-glass reveals it.
 *
 * The snapshot fields plus when it was frozen. `claimedAt` is deliberately absent:
 * the snapshot is written exactly once at claim, so `createdAt` already answers
 * "when", and a second timestamp meaning almost the same thing invites the reader
 * to wonder which one matters.
 */
export const UserAssessmentSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    sessionId: z.string().min(1),
    result: AssessmentResultSchema,
    workflowVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();
export type UserAssessmentSnapshot = z.infer<typeof UserAssessmentSnapshotSchema>;

export const UserAssessmentsResponseSchema = z
  .object({
    snapshots: z.array(UserAssessmentSnapshotSchema),
  })
  .strict();
export type UserAssessmentsResponse = z.infer<typeof UserAssessmentsResponseSchema>;

/**
 * The named set of schemas exported as JSON Schema artifacts. The generator
 * (scripts/generate-json-schema.ts) and the drift-guard test iterate this same
 * record, so the checked-in files can never silently fall out of sync.
 */
export const MORPHEO_CONTRACT_SCHEMAS = {
  AssessmentContentResponse: AssessmentContentResponseSchema,
  ClinicalSourcesResponse: ClinicalSourcesResponseSchema,
  MaintenanceDeleteRequest: MaintenanceDeleteRequestSchema,
  MaintenanceDeleteResult: MaintenanceDeleteResultSchema,
  AccountAssessmentsDeleteRequest: AccountAssessmentsDeleteRequestSchema,
  AssessmentCreateRequest: AssessmentCreateRequestSchema,
  AssessmentCreateResponse: AssessmentCreateResponseSchema,
  AnswerSubmitRequest: AnswerSubmitRequestSchema,
  AssessmentResult: AssessmentResultSchema,
  AssessmentClaimRequest: AssessmentClaimRequestSchema,
  AssessmentClaimTokenResponse: AssessmentClaimTokenResponseSchema,
  AssessmentClaimResponse: AssessmentClaimResponseSchema,
  AssessmentSnapshotResponse: AssessmentSnapshotResponseSchema,
  UserAssessmentsRequest: UserAssessmentsRequestSchema,
  UserAssessmentSnapshot: UserAssessmentSnapshotSchema,
  UserAssessmentsResponse: UserAssessmentsResponseSchema,
} as const;
