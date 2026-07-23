import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

export const OrganizationStatusSchema = z.enum(["active", "suspended"]);

export const OrganizationSchema = z.object({
  id: opaqueIdSchema,
  name: z.string().min(1).max(200),
  status: OrganizationStatusSchema,
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const OrganizationCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
  })
  .strict();
export type OrganizationCreateRequest = z.infer<typeof OrganizationCreateRequestSchema>;

export const OrganizationLocationSchema = z.object({
  id: opaqueIdSchema,
  organizationId: opaqueIdSchema,
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500).optional(),
});
export type OrganizationLocation = z.infer<typeof OrganizationLocationSchema>;

export const OrganizationLocationCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(500).optional(),
  })
  .strict();
export type OrganizationLocationCreateRequest = z.infer<
  typeof OrganizationLocationCreateRequestSchema
>;
