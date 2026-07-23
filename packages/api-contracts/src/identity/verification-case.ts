import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

export const VerificationCaseStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const VerificationCaseSchema = z.object({
  id: opaqueIdSchema,
  professionalProfileId: opaqueIdSchema,
  status: VerificationCaseStatusSchema,
  reviewerId: opaqueIdSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type VerificationCase = z.infer<typeof VerificationCaseSchema>;

export const VerificationCaseCreateRequestSchema = z.object({}).strict();
export type VerificationCaseCreateRequest = z.infer<typeof VerificationCaseCreateRequestSchema>;
