import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

/**
 * Build plan §11: "administrative access and clinical access are
 * different." `read_clinical_data` is the sole clinical action; the
 * other two are both administrative-tier (same policy branch -- see
 * evaluateAdministrativeAccess in somnus-identity-service) and only
 * distinguished for endpoint-level clarity. More actions (e.g.
 * assessment-result access) are added when the phase that needs them
 * lands, not guessed now.
 */
export const AUTHORIZATION_ACTIONS = [
  "read_clinical_data",
  "read_administrative_data",
  "manage_organization",
] as const;
export const AuthorizationActionSchema = z.enum(AUTHORIZATION_ACTIONS);
export type AuthorizationAction = z.infer<typeof AuthorizationActionSchema>;

/**
 * Every path the authorization policy (src/domain/authorization in
 * somnus-identity-service) can return. Unit-tested exhaustively per
 * build plan §20 Checkpoint 6.2; the negative reasonCodes become the
 * immutable suite in Checkpoint 6.3.
 */
export const AUTHORIZATION_REASON_CODES = [
  // allowed
  "AUTHORIZED_SELF_ACCESS",
  "AUTHORIZED_BY_ACTIVE_ACCESS_GRANT",
  "AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE",
  // denied
  "DENIED_ACTOR_ACCOUNT_INACTIVE",
  "DENIED_NO_ACTIVE_MEMBERSHIP",
  "DENIED_CROSS_ORGANIZATION",
  "DENIED_PROFESSIONAL_NOT_VERIFIED",
  "DENIED_ADMINISTRATIVE_ROLE_NOT_CLINICAL",
  "DENIED_SUPPORT_ROLE_HEALTH_DATA_RESTRICTED",
  "DENIED_ACCESS_GRANT_NOT_FOUND",
  "DENIED_ACCESS_GRANT_EXPIRED",
  "DENIED_ACCESS_GRANT_REVOKED",
  "DENIED_CONSENT_WITHDRAWN",
  "DENIED_PERMISSION_NOT_ASSIGNED",
] as const;
export const AuthorizationReasonCodeSchema = z.enum(AUTHORIZATION_REASON_CODES);
export type AuthorizationReasonCode = z.infer<typeof AuthorizationReasonCodeSchema>;

export const AuthorizationCheckRequestSchema = z
  .object({
    actorUserId: opaqueIdSchema,
    subjectUserId: opaqueIdSchema,
    action: AuthorizationActionSchema,
    organizationId: opaqueIdSchema.optional(),
  })
  .strict();
export type AuthorizationCheckRequest = z.infer<typeof AuthorizationCheckRequestSchema>;

export const AuthorizationConstraintsSchema = z.object({
  organizationId: opaqueIdSchema.optional(),
  subjectUserId: opaqueIdSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
});
export type AuthorizationConstraints = z.infer<typeof AuthorizationConstraintsSchema>;

/** POST /internal/v1/authorization/check response (build plan §20 Checkpoint 6.2, exact shape). */
export const AuthorizationCheckResponseSchema = z.object({
  allowed: z.boolean(),
  decisionId: opaqueIdSchema,
  reasonCode: AuthorizationReasonCodeSchema,
  constraints: AuthorizationConstraintsSchema.optional(),
});
export type AuthorizationCheckResponse = z.infer<typeof AuthorizationCheckResponseSchema>;
