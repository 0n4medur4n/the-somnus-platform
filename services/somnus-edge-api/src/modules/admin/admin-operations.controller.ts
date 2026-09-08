import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type AdminDeletionRequest,
  AdminDeletionRequestSchema,
  type AdminOrganizationMember,
  AdminOrganizationMemberSchema,
  type AdminOrganizationSummary,
  AdminOrganizationSummarySchema,
  type AdminRoleAssignResponse,
  AdminRoleAssignResponseSchema,
  type AdminUserDetail,
  AdminUserDetailSchema,
  type AdminUserSearchResponse,
  AdminUserSearchResponseSchema,
  type AdminVerificationCase,
  AdminVerificationCaseSchema,
} from "@somnus/api-contracts";
import { z } from "zod";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import {
  AdminAccountStatusDto,
  AdminDeletionDecisionDto,
  AdminOrganizationCreateDto,
  AdminOrganizationStatusDto,
  AdminRoleAssignDto,
  AdminUserSearchDto,
  AdminVerificationDecisionDto,
} from "./admin.dto.js";
import { AdminProxyService } from "./admin.service.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminRoute } from "./admin-route.decorator.js";

const DeletionRequestListSchema = z.array(AdminDeletionRequestSchema);
const OrganizationListSchema = z.array(AdminOrganizationSummarySchema);
const OrganizationMemberListSchema = z.array(AdminOrganizationMemberSchema);
const VerificationCaseListSchema = z.array(AdminVerificationCaseSchema);
const NoContentSchema = z.unknown();

/**
 * The admin console's operations (Addendum A Checkpoint 15.2).
 *
 * Every handler declares the §A2.2 capability it needs and the audit event it
 * emits, in the same decorator, so a route cannot ship with one and not the
 * other -- and a route with neither is refused by the guard rather than served.
 *
 * Reads are audited as well as writes. Who looked at whose account is precisely
 * what an audit of an internal console has to be able to answer.
 *
 * edge-api decides nothing here: it names the capability, identity answers
 * whether this actor holds it, and the operation itself runs in identity
 * (build plan §5.3).
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminOperationsController {
  constructor(private readonly admin: AdminProxyService) {}

  private actor(session: SessionRecord | undefined): string {
    // The guard resolved and approved the actor before this handler ran.
    return session?.somnusUserId ?? "";
  }

  // --- Users -----------------------------------------------------------

  @Post("users/search")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_users_read",
    eventType: "admin.user.searched.v1",
    entity: "user",
  })
  @ApiOperation({ summary: "Search accounts (metadata only)." })
  async searchUsers(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AdminUserSearchDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminUserSearchResponse> {
    return this.admin.forward({
      method: "POST",
      path: "/internal/v1/admin/users/search",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AdminUserSearchResponseSchema,
      body,
    });
  }

  @Get("users/:userId")
  @AdminRoute({
    capability: "admin_users_read",
    eventType: "admin.user.viewed.v1",
    entity: "user",
  })
  @ApiOperation({ summary: "One account: metadata, profiles, internal roles, memberships." })
  async userDetail(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("userId") userId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminUserDetail> {
    return this.admin.forward({
      method: "GET",
      path: `/internal/v1/admin/users/${encodeURIComponent(userId)}`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AdminUserDetailSchema,
    });
  }

  @Patch("users/:userId/status")
  @AdminRoute({
    capability: "admin_account_status_write",
    eventType: "admin.account_status.changed.v1",
    entity: "user",
  })
  @ApiOperation({ summary: "Suspend or reactivate an account. Reason required." })
  async setUserStatus(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("userId") userId: string,
    @Body() body: AdminAccountStatusDto,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.admin.forward({
      method: "PATCH",
      path: `/internal/v1/admin/users/${encodeURIComponent(userId)}/status`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: NoContentSchema,
      body,
    });
  }

  // --- Deletion requests -----------------------------------------------

  @Get("deletion-requests")
  @AdminRoute({
    capability: "admin_deletion_requests_process",
    eventType: "admin.deletion_request.listed.v1",
    entity: "deletion_request",
  })
  @ApiOperation({ summary: "Pending right-to-erasure requests." })
  async deletionRequests(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminDeletionRequest[]> {
    return this.admin.forward({
      method: "GET",
      path: "/internal/v1/admin/deletion-requests",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: DeletionRequestListSchema,
    });
  }

  @Post("deletion-requests/:requestId/decision")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_deletion_requests_process",
    eventType: "admin.deletion_request.decided.v1",
    entity: "deletion_request",
  })
  @ApiOperation({ summary: "Complete (erase) or cancel a deletion request." })
  async decideDeletion(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("requestId") requestId: string,
    @Body() body: AdminDeletionDecisionDto,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.admin.forward({
      method: "POST",
      path: `/internal/v1/admin/deletion-requests/${encodeURIComponent(requestId)}/decision`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: NoContentSchema,
      body,
    });
  }

  // --- Organizations ---------------------------------------------------

  @Get("organizations")
  @AdminRoute({
    capability: "admin_organizations_manage",
    eventType: "admin.organization.listed.v1",
    entity: "organization",
  })
  @ApiOperation({ summary: "Every organization." })
  async organizations(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminOrganizationSummary[]> {
    return this.admin.forward({
      method: "GET",
      path: "/internal/v1/admin/organizations",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: OrganizationListSchema,
    });
  }

  @Post("organizations")
  @HttpCode(201)
  @AdminRoute({
    capability: "admin_organizations_manage",
    eventType: "admin.organization.created.v1",
    entity: "organization",
  })
  @ApiOperation({ summary: "Create an organization. The creating admin does not join it." })
  async createOrganization(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AdminOrganizationCreateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminOrganizationSummary> {
    return this.admin.forward({
      method: "POST",
      path: "/internal/v1/admin/organizations",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AdminOrganizationSummarySchema,
      body,
    });
  }

  @Patch("organizations/:organizationId/status")
  @AdminRoute({
    capability: "admin_organizations_manage",
    eventType: "admin.organization_status.changed.v1",
    entity: "organization",
  })
  @ApiOperation({ summary: "Approve (activate) or suspend an organization." })
  async setOrganizationStatus(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("organizationId") organizationId: string,
    @Body() body: AdminOrganizationStatusDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminOrganizationSummary> {
    return this.admin.forward({
      method: "PATCH",
      path: `/internal/v1/admin/organizations/${encodeURIComponent(organizationId)}/status`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AdminOrganizationSummarySchema,
      body,
    });
  }

  @Get("organizations/:organizationId/members")
  @AdminRoute({
    capability: "admin_organizations_manage",
    eventType: "admin.organization_members.viewed.v1",
    entity: "organization",
  })
  @ApiOperation({ summary: "The organization roster, by opaque user id." })
  async organizationMembers(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("organizationId") organizationId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminOrganizationMember[]> {
    return this.admin.forward({
      method: "GET",
      path: `/internal/v1/admin/organizations/${encodeURIComponent(organizationId)}/members`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: OrganizationMemberListSchema,
    });
  }

  // --- Professional verification queue ---------------------------------

  @Get("verification-cases")
  @AdminRoute({
    capability: "admin_verification_queue",
    eventType: "admin.verification_queue.viewed.v1",
    entity: "verification_case",
  })
  @ApiOperation({ summary: "The professional verification queue." })
  async verificationQueue(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminVerificationCase[]> {
    return this.admin.forward({
      method: "GET",
      path: "/internal/v1/admin/verification-cases",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: VerificationCaseListSchema,
    });
  }

  @Post("verification-cases/:caseId/decision")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_verification_queue",
    eventType: "admin.verification_case.decided.v1",
    entity: "verification_case",
  })
  @ApiOperation({ summary: "Approve or reject a case. Reason required for both outcomes." })
  async decideVerification(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("caseId") caseId: string,
    @Body() body: AdminVerificationDecisionDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminVerificationCase> {
    return this.admin.forward({
      method: "POST",
      path: `/internal/v1/admin/verification-cases/${encodeURIComponent(caseId)}/decision`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AdminVerificationCaseSchema,
      body,
    });
  }

  // --- Internal roles (platform_super_admin only) ----------------------

  @Post("roles/assign")
  @HttpCode(201)
  @AdminRoute({
    capability: "admin_roles_assign",
    eventType: "admin.internal_role.granted.v1",
    entity: "user",
  })
  @ApiOperation({ summary: "Assign an internal role. Never to oneself." })
  async assignRole(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AdminRoleAssignDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminRoleAssignResponse> {
    return this.admin.forward({
      method: "POST",
      path: "/internal/v1/admin/roles/assign",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AdminRoleAssignResponseSchema,
      body,
    });
  }
}
