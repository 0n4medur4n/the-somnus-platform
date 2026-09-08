import {
  AdminAccountStatusRequestSchema,
  AdminDeletionDecisionRequestSchema,
  AdminOrganizationCreateRequestSchema,
  AdminOrganizationStatusRequestSchema,
  AdminRoleAssignRequestSchema,
  AdminUserSearchRequestSchema,
  AdminVerificationDecisionRequestSchema,
  ContentReviewDecisionRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";

/**
 * Request bodies for the admin console surface (Addendum A Checkpoint 15.2),
 * validated at the edge before anything is proxied -- the same Zod contracts
 * identity validates against, so the boundary cannot drift.
 */
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
/** Checkpoint 15.3: reason required for approve AND reject, as 15.2 requires it. */
export class ContentReviewDecisionDto extends createZodDto(ContentReviewDecisionRequestSchema) {}
