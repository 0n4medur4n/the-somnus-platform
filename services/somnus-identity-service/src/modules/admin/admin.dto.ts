import {
  AdminAccountStatusRequestSchema,
  AdminDeletionDecisionRequestSchema,
  AdminOrganizationCreateRequestSchema,
  AdminOrganizationStatusRequestSchema,
  AdminRoleAssignRequestSchema,
  AdminUserSearchRequestSchema,
  AdminVerificationDecisionRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/** Request bodies for the admin console surface (Addendum A Checkpoint 15.2). */
export class AdminUserSearchDto extends createZodDto(AdminUserSearchRequestSchema) {}
export class AdminAccountStatusDto extends createZodDto(AdminAccountStatusRequestSchema) {}
export class AdminDeletionDecisionDto extends createZodDto(AdminDeletionDecisionRequestSchema) {}
export class AdminOrganizationCreateDto extends createZodDto(
  AdminOrganizationCreateRequestSchema,
) {}
export class AdminOrganizationStatusDto extends createZodDto(
  AdminOrganizationStatusRequestSchema,
) {}
export class AdminVerificationDecisionDto extends createZodDto(
  AdminVerificationDecisionRequestSchema,
) {}
export class AdminRoleAssignDto extends createZodDto(AdminRoleAssignRequestSchema) {}
