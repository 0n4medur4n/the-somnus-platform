import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { opaqueIdSchema } from "../uuid.js";
import { RegistrationRequestSchema } from "./user.js";

/** Morpheo onboarding only. Neither branch grants professional or Nox permissions. */
export const PlatformInvitationCreateRequestSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(["adult", "professional"]),
    locale: LocaleSchema,
  })
  .strict();
export type PlatformInvitationCreateRequest = z.infer<typeof PlatformInvitationCreateRequestSchema>;
export const PlatformInvitationSchema = PlatformInvitationCreateRequestSchema.extend({
  id: opaqueIdSchema,
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  invitedBy: opaqueIdSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
});
export type PlatformInvitation = z.infer<typeof PlatformInvitationSchema>;
export const PlatformInvitationListResponseSchema = z.object({
  invitations: z.array(PlatformInvitationSchema),
});
export type PlatformInvitationListResponse = z.infer<typeof PlatformInvitationListResponseSchema>;
export const PlatformInvitationCreateResponseSchema = z.object({
  invitation: PlatformInvitationSchema,
  emailQueued: z.boolean(),
});
export type PlatformInvitationCreateResponse = z.infer<
  typeof PlatformInvitationCreateResponseSchema
>;
export const PlatformInvitationLookupRequestSchema = z
  .object({ invitationId: opaqueIdSchema })
  .strict();
export const PlatformInvitationAcceptRequestSchema = z
  .object({
    invitationId: opaqueIdSchema,
    /** New accounts complete the normal registration themselves; existing accounts send no profile. */
    registration: RegistrationRequestSchema.optional(),
  })
  .strict();
export type PlatformInvitationAcceptRequest = z.infer<typeof PlatformInvitationAcceptRequestSchema>;
/** Internal only: identity proof always comes from the session at edge. */
export const PlatformInvitationIdentitySchema = z
  .object({
    invitationId: opaqueIdSchema,
    email: z.string().trim().toLowerCase().email().max(320),
    providerUserId: z.string().min(1).max(128),
  })
  .strict();
export const PlatformInvitationAcceptInternalRequestSchema =
  PlatformInvitationIdentitySchema.extend({ registration: RegistrationRequestSchema.optional() });
export type PlatformInvitationAcceptInternalRequest = z.infer<
  typeof PlatformInvitationAcceptInternalRequestSchema
>;
