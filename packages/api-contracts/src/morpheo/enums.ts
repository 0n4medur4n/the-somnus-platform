import { z } from "zod";

/**
 * The edge <-> morpheo boundary vocabulary (build plan §5.5 / §14). These
 * enums MUST stay identical to Morpheo's clinical enums (RoleId, ModuleId,
 * SafetyLevelId in services/morpheo-service/src/morpheo/clinical/models.py),
 * which are themselves seeded from the versioned artifacts (§14a). The Python
 * contract test asserts that parity, so a divergence fails CI on both sides.
 */

export const MORPHEO_ROLES = ["adult", "parent", "professional"] as const;
export const RoleIdSchema = z.enum(MORPHEO_ROLES);
export type RoleId = z.infer<typeof RoleIdSchema>;

export const MORPHEO_SAFETY_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export const SafetyLevelIdSchema = z.enum(MORPHEO_SAFETY_LEVELS);
export type SafetyLevelId = z.infer<typeof SafetyLevelIdSchema>;

/**
 * The profile's non-urgent orientation. L0/L1 are emergency/urgent and can
 * only arise from a fired safety rule, never as a base — this mirrors the
 * engine's `AssessmentInput` guard exactly.
 */
export const MORPHEO_BASE_ORIENTATIONS = ["L2", "L3", "L4"] as const;
export const BaseOrientationSchema = z.enum(MORPHEO_BASE_ORIENTATIONS);
export type BaseOrientation = z.infer<typeof BaseOrientationSchema>;

export const MORPHEO_MODULES = ["INS", "BRE", "SLP", "CIR", "RLS", "PAR"] as const;
export const ModuleIdSchema = z.enum(MORPHEO_MODULES);
export type ModuleId = z.infer<typeof ModuleIdSchema>;

/** An incremental answer is either a reported complaint phrase or a safety signal. */
export const ANSWER_KINDS = ["complaint", "signal"] as const;
export const AnswerKindSchema = z.enum(ANSWER_KINDS);
export type AnswerKind = z.infer<typeof AnswerKindSchema>;

/** Three-valued signal answer: "unknown" is never coerced to "false" (§14b). */
export const TERNARY_VALUES = ["true", "false", "unknown"] as const;
export const TernaryValueSchema = z.enum(TERNARY_VALUES);
export type TernaryValue = z.infer<typeof TernaryValueSchema>;

/** Why an entry gate blocked a session (mirrors morpheo's enforce_entry_gate). */
export const GATE_REASONS = ["privacy_block", "consent_required", "ineligible"] as const;
export const GateReasonSchema = z.enum(GATE_REASONS);
export type GateReason = z.infer<typeof GateReasonSchema>;

/** Why a claim was rejected (single-use token already spent or expired). */
export const CLAIM_REJECT_REASONS = ["already_claimed_or_expired"] as const;
export const ClaimRejectReasonSchema = z.enum(CLAIM_REJECT_REASONS);
export type ClaimRejectReason = z.infer<typeof ClaimRejectReasonSchema>;
