import { z } from "zod";
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
 * The named set of schemas exported as JSON Schema artifacts. The generator
 * (scripts/generate-json-schema.ts) and the drift-guard test iterate this same
 * record, so the checked-in files can never silently fall out of sync.
 */
export const MORPHEO_CONTRACT_SCHEMAS = {
  AssessmentCreateRequest: AssessmentCreateRequestSchema,
  AssessmentCreateResponse: AssessmentCreateResponseSchema,
  AnswerSubmitRequest: AnswerSubmitRequestSchema,
  AssessmentResult: AssessmentResultSchema,
  AssessmentClaimRequest: AssessmentClaimRequestSchema,
  AssessmentClaimResponse: AssessmentClaimResponseSchema,
  AssessmentSnapshotResponse: AssessmentSnapshotResponseSchema,
} as const;
