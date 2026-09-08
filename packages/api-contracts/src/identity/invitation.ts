import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";
import { RoleKeySchema } from "./roles.js";

export const InvitationStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);

/** The token is never included -- it is only ever returned once, from create(). */
export const InvitationSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  email: z.string().email(),
  roleKey: RoleKeySchema.optional(),
  status: InvitationStatusSchema,
  expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const InvitationCreateRequestSchema = z
  .object({
    email: z.string().email(),
    roleKey: RoleKeySchema.optional(),
  })
  .strict();
export type InvitationCreateRequest = z.infer<typeof InvitationCreateRequestSchema>;

/** The token is single-use (build plan §20 Checkpoint 6.3): accept() is a no-op on a reused token. */
export const InvitationCreateResponseSchema = z.object({
  invitation: InvitationSchema,
  token: z.string().min(1),
});
export type InvitationCreateResponse = z.infer<typeof InvitationCreateResponseSchema>;

export const InvitationAcceptRequestSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();
export type InvitationAcceptRequest = z.infer<typeof InvitationAcceptRequestSchema>;

export const InvitationPreviewRequestSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();
export type InvitationPreviewRequest = z.infer<typeof InvitationPreviewRequestSchema>;

/**
 * Pre-login view of an invitation (Addendum A Checkpoint 14.2). Nox has no
 * public signup, so the invited person needs to know -- before they have any
 * session -- which organization invited them and whether the invitation is
 * still usable.
 *
 * Deliberately minimal. It carries the organization NAME but not its id, the
 * invited email (which the holder of the token already has: it was mailed to
 * them), and the expiry. It never carries the role, the inviter, the member
 * list, or anything else an unauthenticated caller has no business reading.
 * An unusable invitation is not represented here at all -- it is an error
 * with a stable code (INVITATION_EXPIRED / INVITATION_ALREADY_USED /
 * INVITATION_NOT_FOUND), so the UI can say which without guessing.
 */
export const InvitationPreviewResponseSchema = z.object({
  organizationName: z.string().min(1),
  email: z.string().email(),
  expiresAt: z.iso.datetime(),
});
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponseSchema>;
