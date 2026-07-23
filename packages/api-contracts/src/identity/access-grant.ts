import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

export const AccessGrantStatusSchema = z.enum(["active", "revoked", "expired"]);

export const AccessGrantSchema = z.object({
  id: opaqueIdSchema,
  professionalUserId: opaqueIdSchema,
  subjectUserId: opaqueIdSchema,
  organizationId: opaqueIdSchema.optional(),
  scope: z.string().min(1).max(120),
  status: AccessGrantStatusSchema,
  expiresAt: z.iso.datetime().optional(),
});
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const AccessGrantCreateRequestSchema = z
  .object({
    professionalUserId: opaqueIdSchema,
    organizationId: opaqueIdSchema.optional(),
    scope: z.string().min(1).max(120),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();
export type AccessGrantCreateRequest = z.infer<typeof AccessGrantCreateRequestSchema>;
