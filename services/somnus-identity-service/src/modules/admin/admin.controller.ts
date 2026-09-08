import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  AdminDeletionRequest,
  AdminOrganizationMember,
  AdminOrganizationSummary,
  AdminRoleAssignResponse,
  AdminUserDetail,
  AdminUserSearchResponse,
  AdminVerificationCase,
} from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import {
  AdminAccountStatusDto,
  AdminDeletionDecisionDto,
  AdminOrganizationCreateDto,
  AdminOrganizationStatusDto,
  AdminRoleAssignDto,
  AdminUserSearchDto,
  AdminVerificationDecisionDto,
} from "./admin.dto.js";
import { AdminOrganizationsService } from "./admin-organizations.service.js";
import { AdminUsersService } from "./admin-users.service.js";
import { AdminVerificationService } from "./admin-verification.service.js";
import { InternalRolesService } from "./internal-roles.service.js";

/** How many rows an admin list returns before it asks the admin to narrow down. */
const DEFAULT_LIMIT = 25;

/**
 * The admin console's operations (Addendum A Checkpoint 15.2), internal-only
 * like every other identity route (build plan §16 `/internal/v1/`).
 *
 * These endpoints do NOT check the capability matrix: edge-api's
 * `AdminCapabilityGuard` has already asked identity's own authorization service
 * whether this actor may be here, per route, before forwarding. What each
 * handler receives is an actor that has been permitted; the invariants that
 * must hold regardless live in the services below it.
 */
@ApiTags("admin")
@Controller({ path: "internal/v1/admin" })
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Post("users/search")
  @HttpCode(200)
  @ApiOperation({ summary: "Search accounts by address and status (metadata only)." })
  async search(@Body() body: AdminUserSearchDto): Promise<AdminUserSearchResponse> {
    return this.users.search(body);
  }

  @Get("users/:userId")
  @ApiOperation({ summary: "One account: metadata, profiles, internal roles, memberships." })
  async detail(@Param("userId") userId: string): Promise<AdminUserDetail> {
    return this.users.detail(userId);
  }

  @Patch("users/:userId/status")
  @ApiOperation({ summary: "Suspend or reactivate an account. Reason required." })
  async setStatus(
    @CurrentActorId() actorId: string,
    @Param("userId") userId: string,
    @Body() body: AdminAccountStatusDto,
  ): Promise<void> {
    await this.users.setAccountStatus({
      targetUserId: userId,
      status: body.status,
      reason: body.reason,
      actingAdminUserId: actorId,
    });
  }

  @Get("deletion-requests")
  @ApiOperation({ summary: "Pending right-to-erasure requests." })
  async deletionRequests(@Query("limit") limit?: string): Promise<AdminDeletionRequest[]> {
    return this.users.listDeletionRequests(Number(limit) || DEFAULT_LIMIT);
  }

  @Post("deletion-requests/:requestId/decision")
  @HttpCode(200)
  @ApiOperation({ summary: "Complete (erase) or cancel a deletion request. Reason required." })
  async decideDeletion(
    @CurrentActorId() actorId: string,
    @Param("requestId") requestId: string,
    @Body() body: AdminDeletionDecisionDto,
  ): Promise<void> {
    await this.users.decideDeletionRequest({
      requestId,
      decision: body.decision,
      reason: body.reason,
      actingAdminUserId: actorId,
    });
  }
}

@ApiTags("admin")
@Controller({ path: "internal/v1/admin/organizations" })
export class AdminOrganizationsController {
  constructor(private readonly organizations: AdminOrganizationsService) {}

  @Get()
  @ApiOperation({ summary: "Every organization." })
  async list(@Query("limit") limit?: string): Promise<AdminOrganizationSummary[]> {
    return this.organizations.list(Number(limit) || DEFAULT_LIMIT);
  }

  @Post()
  @ApiOperation({ summary: "Create an organization. The creating admin does not join it." })
  async create(@Body() body: AdminOrganizationCreateDto): Promise<AdminOrganizationSummary> {
    return this.organizations.create(body.name);
  }

  @Patch(":organizationId/status")
  @ApiOperation({ summary: "Approve (activate) or suspend an organization. Reason required." })
  async setStatus(
    @CurrentActorId() actorId: string,
    @Param("organizationId") organizationId: string,
    @Body() body: AdminOrganizationStatusDto,
  ): Promise<AdminOrganizationSummary> {
    return this.organizations.setStatus({
      organizationId,
      status: body.status,
      reason: body.reason,
      actingAdminUserId: actorId,
    });
  }

  @Get(":organizationId/members")
  @ApiOperation({ summary: "The organization roster, by opaque user id." })
  async members(
    @Param("organizationId") organizationId: string,
  ): Promise<AdminOrganizationMember[]> {
    return this.organizations.members(organizationId);
  }
}

@ApiTags("admin")
@Controller({ path: "internal/v1/admin/verification-cases" })
export class AdminVerificationController {
  constructor(private readonly verification: AdminVerificationService) {}

  @Get()
  @ApiOperation({ summary: "The professional verification queue (pending cases)." })
  async queue(@Query("limit") limit?: string): Promise<AdminVerificationCase[]> {
    return this.verification.queue(Number(limit) || DEFAULT_LIMIT);
  }

  @Post(":caseId/decision")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve or reject a verification case. Reason required for both." })
  async decide(
    @CurrentActorId() actorId: string,
    @Param("caseId") caseId: string,
    @Body() body: AdminVerificationDecisionDto,
  ): Promise<AdminVerificationCase> {
    return this.verification.decide({
      caseId,
      decision: body.decision,
      reason: body.reason,
      reviewerId: actorId,
      correlationId: `admin-verification-${caseId}`,
    });
  }
}

@ApiTags("admin")
@Controller({ path: "internal/v1/admin/roles" })
export class AdminRolesController {
  constructor(private readonly internalRoles: InternalRolesService) {}

  @Post("assign")
  @HttpCode(201)
  @ApiOperation({
    summary: "Assign an internal role. platform_super_admin only; never to oneself.",
  })
  async assign(
    @CurrentActorId() actorId: string,
    @Body() body: AdminRoleAssignDto,
  ): Promise<AdminRoleAssignResponse> {
    return this.internalRoles.assignInternalRole({
      targetUserId: body.targetUserId,
      roleKey: body.roleKey,
      source: { kind: "console", actingAdminUserId: actorId },
      correlationId: `admin-roles-${actorId}`,
    });
  }
}
