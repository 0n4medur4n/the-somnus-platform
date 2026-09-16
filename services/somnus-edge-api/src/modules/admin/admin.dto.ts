import {
  AdminAccountStatusRequestSchema,
  AdminDeletionDecisionRequestSchema,
  AdminOrganizationCreateRequestSchema,
  AdminOrganizationStatusRequestSchema,
  AdminRoleAssignRequestSchema,
  AdminUserSearchRequestSchema,
  AdminVerificationDecisionRequestSchema,
  AuditQueryRequestSchema,
  BreakGlassRevealRequestSchema,
  ContentReviewDecisionRequestSchema,
  CorpusDocumentCreateRequestSchema,
  CorpusDocumentEditRequestSchema,
  CorpusPublishRequestSchema,
  CorpusRetireRequestSchema,
  CorpusSearchRequestSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

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

/** The audit log viewer's four filters (§A2.4 / Checkpoint 15.4). */
export class AdminAuditQueryDto extends createZodDto(AuditQueryRequestSchema) {}

/** The dashboard window; both ends optional. */
export const AdminDashboardWindowSchema = z
  .object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() })
  .strict();
export class AdminDashboardWindowDto extends createZodDto(AdminDashboardWindowSchema) {}

/**
 * Break-glass reveal (§A2.3 / Checkpoint 15.5).
 *
 * The gate is the DTO, not a check inside the handler: a request without a
 * category, or with a justification below the minimum, never reaches the
 * controller, so "reveal first, justify later" is not a state this route can be
 * driven into.
 */
export class BreakGlassRevealDto extends createZodDto(BreakGlassRevealRequestSchema) {}

/**
 * Reference-corpus management (Addendum B §B3 / Checkpoint 16.3).
 *
 * Note what is absent: no delete body, because there is no delete route, and no
 * field anywhere that names an SRC's identifier, citation, `use` or citing rules.
 * These schemas are `.strict()`, so a request carrying one of those is refused
 * here, before any handler runs -- which is what makes §B3.1's "read-only" a
 * property of the boundary rather than of the screen.
 */
export class CorpusSearchDto extends createZodDto(CorpusSearchRequestSchema) {}
export class CorpusDocumentCreateDto extends createZodDto(CorpusDocumentCreateRequestSchema) {}
export class CorpusDocumentEditDto extends createZodDto(CorpusDocumentEditRequestSchema) {}
export class CorpusPublishDto extends createZodDto(CorpusPublishRequestSchema) {}
export class CorpusRetireDto extends createZodDto(CorpusRetireRequestSchema) {}
