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
