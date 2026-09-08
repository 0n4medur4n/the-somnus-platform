/**
 * Build plan §3.4: "The OpenAPI specification is generated from the
 * Zod schemas (via nestjs-zod's OpenAPI integration with
 * @nestjs/swagger)." Each DTO subclasses `createZodDto(Schema)` from
 * `@somnus/api-contracts` -- the schema stays the single source of
 * truth; this class only exists so `@nestjs/swagger` has a reflectable
 * type to generate a request-body schema from, and so nestjs-zod's
 * global ZodValidationPipe (see app.module.ts) can recognize and
 * validate it automatically.
 */

import {
  AccessGrantCreateRequestSchema,
  AdminCapabilityCheckRequestSchema,
  AdminContextRequestSchema,
  AuthorizationCheckRequestSchema,
  InvitationAcceptRequestSchema,
  InvitationCreateRequestSchema,
  InvitationPreviewRequestSchema,
  MembershipPatchRequestSchema,
  OrganizationCreateRequestSchema,
  OrganizationStatusSchema,
  ProfilePatchRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class ProfilePatchDto extends createZodDto(ProfilePatchRequestSchema) {}
export class OrganizationCreateDto extends createZodDto(OrganizationCreateRequestSchema) {}

const OrganizationUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    status: OrganizationStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required." });
export class OrganizationUpdateDto extends createZodDto(OrganizationUpdateRequestSchema) {}

export class MembershipPatchDto extends createZodDto(MembershipPatchRequestSchema) {}
export class InvitationCreateDto extends createZodDto(InvitationCreateRequestSchema) {}
export class InvitationAcceptDto extends createZodDto(InvitationAcceptRequestSchema) {}
export class InvitationPreviewDto extends createZodDto(InvitationPreviewRequestSchema) {}

/** Admin console gate (Addendum A Checkpoint 15.1). */
export class AdminCapabilityCheckDto extends createZodDto(AdminCapabilityCheckRequestSchema) {}
export class AdminContextDto extends createZodDto(AdminContextRequestSchema) {}
export class AccessGrantCreateDto extends createZodDto(AccessGrantCreateRequestSchema) {}
export class AuthorizationCheckDto extends createZodDto(AuthorizationCheckRequestSchema) {}
