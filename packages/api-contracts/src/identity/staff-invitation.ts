import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { opaqueIdSchema } from "../uuid.js";
import type { RoleKey } from "./roles.js";

/**
 * Inviting a member of The Somnus staff from the admin console (owner decision
 * 2026-10-18).
 *
 * Nobody gets an account they did not open themselves: the admin writes down
 * who is being invited and with which internal role, the person receives an
 * access link to the console, and the account is created only when THEY sign in
 * with that address and accept -- acknowledging the privacy policy themselves.
 * The role is granted at that moment, through the same single path as every
 * other internal role (InternalRolesService), on behalf of the admin who invited.
 *
 * Internal roles only. People who use the platform, and professionals, keep
 * registering on their own.
 */

/** The roles an invitation can carry: exactly the internal ones. */
export const STAFF_INVITATION_ROLE_KEYS = [
  "support_agent",
  "professional_verifier",
  "clinical_governance_reviewer",
  "platform_admin",
  "platform_super_admin",
] as const satisfies ReadonlyArray<RoleKey>;
export const StaffInvitationRoleKeySchema = z.enum(STAFF_INVITATION_ROLE_KEYS);
export type StaffInvitationRoleKey = z.infer<typeof StaffInvitationRoleKeySchema>;

/** How long an invitation can be accepted for. */
export const STAFF_INVITATION_TTL_DAYS = 7;

/** `expired` is derived from `expiresAt`; nothing sweeps the table. */
export const STAFF_INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export const StaffInvitationStatusSchema = z.enum(STAFF_INVITATION_STATUSES);
export type StaffInvitationStatus = z.infer<typeof StaffInvitationStatusSchema>;

const nameSchema = z.string().trim().min(1).max(120);

export const StaffInvitationCreateRequestSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: z.string().trim().toLowerCase().email().max(320),
    roleKey: StaffInvitationRoleKeySchema,
    /** The language of the email the person receives. */
    locale: LocaleSchema.default("es"),
  })
  .strict();
export type StaffInvitationCreateRequest = z.infer<typeof StaffInvitationCreateRequestSchema>;

export const StaffInvitationSchema = z.object({
  id: opaqueIdSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  roleKey: StaffInvitationRoleKeySchema,
  locale: LocaleSchema,
  status: StaffInvitationStatusSchema,
  invitedBy: opaqueIdSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
});
export type StaffInvitation = z.infer<typeof StaffInvitationSchema>;

export const StaffInvitationListResponseSchema = z.object({
  invitations: z.array(StaffInvitationSchema),
});
export type StaffInvitationListResponse = z.infer<typeof StaffInvitationListResponseSchema>;

/**
 * `POST /admin/v1/staff-invitations`. Creating an invitation for an address that
 * already has a pending one replaces it (and sends the email again), which is
 * how the console "resends". `emailSent` is false when the invitation was saved
 * but the email could not be queued: the console says so and offers to resend.
 */
export const StaffInvitationCreateResponseSchema = z.object({
  invitation: StaffInvitationSchema,
  emailSent: z.boolean(),
});
export type StaffInvitationCreateResponse = z.infer<typeof StaffInvitationCreateResponseSchema>;

/**
 * `GET /v1/staff-invitation` -- what the signed-in person was invited as, if
 * anything. Only the session's own verified address is ever looked up, so this
 * reveals nothing to anyone else. `null` when there is no usable invitation.
 */
export const StaffInvitationPendingSchema = z.object({
  firstName: z.string(),
  roleKey: StaffInvitationRoleKeySchema,
  expiresAt: z.iso.datetime(),
});
export const StaffInvitationPendingResponseSchema = z.object({
  invitation: StaffInvitationPendingSchema.nullable(),
});
export type StaffInvitationPendingResponse = z.infer<typeof StaffInvitationPendingResponseSchema>;

/** `POST /v1/staff-invitation/accept` -- the person accepts the privacy policy and joins. */
export const StaffInvitationAcceptRequestSchema = z
  .object({
    privacyPolicyAcknowledged: z.literal(true),
  })
  .strict();
export type StaffInvitationAcceptRequest = z.infer<typeof StaffInvitationAcceptRequestSchema>;

// --- edge -> identity (internal) --------------------------------------------

export const StaffInvitationLookupRequestSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(320) })
  .strict();
export type StaffInvitationLookupRequest = z.infer<typeof StaffInvitationLookupRequestSchema>;

export const StaffInvitationAcceptInternalRequestSchema = z
  .object({
    providerUserId: z.string().min(1).max(128),
    /** The address the session verified -- never one the client typed. */
    email: z.string().trim().toLowerCase().email().max(320),
  })
  .strict();
export type StaffInvitationAcceptInternalRequest = z.infer<
  typeof StaffInvitationAcceptInternalRequestSchema
>;

/** Whether a role key can be carried by a staff invitation. */
export function isStaffInvitationRoleKey(value: string): value is StaffInvitationRoleKey {
  return (STAFF_INVITATION_ROLE_KEYS as ReadonlyArray<string>).includes(value);
}
