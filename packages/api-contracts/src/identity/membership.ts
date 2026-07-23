import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

export const MembershipStatusSchema = z.enum(["active", "inactive", "removed"]);

export const MembershipSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  userId: opaqueIdSchema,
  status: MembershipStatusSchema,
});
export type Membership = z.infer<typeof MembershipSchema>;

export const MembershipPatchRequestSchema = z
  .object({
    status: MembershipStatusSchema,
  })
  .strict();
export type MembershipPatchRequest = z.infer<typeof MembershipPatchRequestSchema>;
