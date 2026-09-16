import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";
import { RoleKeySchema } from "./roles.js";
import { UserSchema } from "./user.js";

/**
 * The admin console's capability vocabulary (Addendum A §A2.2 / Checkpoint
 * 15.1). One capability per row of the matrix, named after what it permits
 * rather than after a screen, so a later UI change cannot quietly widen it.
 *
 * These are deliberately NOT added to `AUTHORIZATION_ACTIONS`. That enum is the
 * clinical/organizational axis pinned by Checkpoint 6.2's exact response shape
 * and 6.3's immutable negative suite; admin capabilities are a different axis
 * (platform-scoped, role-driven, no subject and no organization), and merging
 * them would have meant touching a contract that is deliberately frozen.
 *
 * The role -> capability matrix itself lives in identity's pure policy
 * (`src/domain/authorization/admin-capability-policy.ts`), never here and never
 * in edge-api: build plan §5.3 forbids duplicating an authorization decision
 * outside identity. edge-api only knows which capability a route requires.
 */
export const ADMIN_CAPABILITIES = [
  /** Search users, view account status/metadata. */
  "admin_users_read",
  /** Suspend / reactivate an account. */
  "admin_account_status_write",
  /** Process deletion requests. */
  "admin_deletion_requests_process",
  /** Professional verification queue (approve/reject). */
  "admin_verification_queue",
  /** Organizations: create, approve, view members. */
  "admin_organizations_manage",
  /** Assign internal roles. */
  "admin_roles_assign",
  /** AI content review queue. */
  "admin_content_review",
  /** Statistics dashboards (aggregate, from BigQuery). */
  "admin_statistics_read",
  /** Audit log viewer. */
  "admin_audit_read",
  /**
   * Export the audit log to CSV. Separate from reading it: §A4 Checkpoint 15.4
   * restricts the export to `platform_super_admin`, while the on-screen viewer
   * is open to the wider set §A2.2 lists. One capability could not express both.
   */
  "admin_audit_export",
  /** Consent records viewer (per user, metadata only). */
  "admin_consent_read",
  /** Break-glass: view an individual's clinical answers/results. Justification required. */
  "admin_break_glass",
  /** System health (service status, queue depths, error rates). */
  "admin_system_health",
  /**
   * Reference-corpus management (Addendum B §B5 Checkpoint 16.3).
   *
   * `platform_super_admin` ALONE, decided in §B6 item 4 with no separate review
   * gate: the single-role restriction is the control. Deliberately the narrowest
   * row in the matrix apart from internal role assignment, because a published
   * corpus document is what an AI wording step grounds in.
   */
  "admin_corpus_manage",
] as const;

export const AdminCapabilitySchema = z.enum(ADMIN_CAPABILITIES);
export type AdminCapability = z.infer<typeof AdminCapabilitySchema>;

/**
 * Capabilities that reach an individual person's clinical data and therefore
 * require a recorded justification before anything is shown (§A2.3). Kept next
 * to the vocabulary so a new clinical-reach capability has to decide, in this
 * file, whether it belongs here.
 */
export const JUSTIFICATION_REQUIRED_CAPABILITIES: ReadonlySet<AdminCapability> = new Set([
  "admin_break_glass",
]);

/** `POST /internal/v1/authorization/admin-check` — one capability, one decision. */
export const AdminCapabilityCheckRequestSchema = z
  .object({
    actorUserId: opaqueIdSchema,
    capability: AdminCapabilitySchema,
  })
  .strict();
export type AdminCapabilityCheckRequest = z.infer<typeof AdminCapabilityCheckRequestSchema>;

export const ADMIN_AUTHORIZATION_REASON_CODES = [
  "AUTHORIZED_BY_INTERNAL_ROLE",
  /** The actor holds no internal role at all: not an admin. */
  "DENIED_NOT_AN_INTERNAL_ROLE",
  /** An internal role, but not one this capability's matrix row grants. */
  "DENIED_CAPABILITY_NOT_GRANTED",
  /** Suspended or deleted accounts are refused before any capability is considered. */
  "DENIED_ACTOR_ACCOUNT_INACTIVE",
] as const;
export const AdminAuthorizationReasonCodeSchema = z.enum(ADMIN_AUTHORIZATION_REASON_CODES);
export type AdminAuthorizationReasonCode = z.infer<typeof AdminAuthorizationReasonCodeSchema>;

export const AdminCapabilityCheckResponseSchema = z.object({
  allowed: z.boolean(),
  decisionId: opaqueIdSchema,
  reasonCode: AdminAuthorizationReasonCodeSchema,
});
export type AdminCapabilityCheckResponse = z.infer<typeof AdminCapabilityCheckResponseSchema>;

/** `POST /internal/v1/authorization/admin-context` — everything the shell needs, in one call. */
export const AdminContextRequestSchema = z.object({ actorUserId: opaqueIdSchema }).strict();
export type AdminContextRequest = z.infer<typeof AdminContextRequestSchema>;

/**
 * The console shell's view of who it is talking to.
 *
 * `roleKeys` lists ONLY internal roles: an admin who also happens to be a
 * professional has no business seeing that here, and the console must never be
 * able to infer external permissions from it. `capabilities` is the resolved
 * matrix row, so the shell renders from a decision identity made rather than
 * re-deriving one.
 */
export const AdminContextResponseSchema = z.object({
  roleKeys: z.array(RoleKeySchema),
  capabilities: z.array(AdminCapabilitySchema),
});
export type AdminContextResponse = z.infer<typeof AdminContextResponseSchema>;

/** `GET /admin/v1/me` — the console shell's own endpoint. */
export const AdminMeResponseSchema = z.object({
  user: UserSchema,
  roleKeys: z.array(RoleKeySchema),
  capabilities: z.array(AdminCapabilitySchema),
});
export type AdminMeResponse = z.infer<typeof AdminMeResponseSchema>;
