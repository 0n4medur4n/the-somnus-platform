import { Injectable } from "@nestjs/common";
import {
  INTERNAL_ROLE_KEYS,
  type Invitation,
  type InvitationCreateRequest,
  type InvitationCreateResponse,
  type UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { OrganizationInvitationsRepository } from "../../infrastructure/db/repositories/organization-invitations.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { RoleAssignmentsRepository } from "../../infrastructure/db/repositories/role-assignments.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { RolesRepository } from "../../infrastructure/db/repositories/roles.repository.js";

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000; // 72h, matching the build plan §14 claim-token convention.

function toInvitation(row: {
  id: string;
  organizationId: string;
  email: string;
  roleId: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
  };
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: OrganizationInvitationsRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly roles: RolesRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(
    actorId: UUIDv7,
    organizationId: UUIDv7,
    input: InvitationCreateRequest,
  ): Promise<InvitationCreateResponse> {
    const decision = await this.authorizationService.check({
      actorUserId: actorId,
      subjectUserId: actorId,
      action: "manage_organization",
      organizationId,
    });
    if (!decision.allowed) {
      throw new SomnusError(
        ErrorCode.FORBIDDEN,
        "Not allowed to invite members to this organization.",
        {
          correlationId: "invitations",
          details: { reasonCode: decision.reasonCode },
        },
      );
    }

    // Build plan §20 Checkpoint 6.3: an organization invitation may only
    // grant an external, organization-scoped role. Internal/platform
    // roles (support_agent, professional_verifier,
    // clinical_governance_reviewer, platform_admin,
    // platform_super_admin) are never assignable through self-service
    // invitations, no matter who the inviter is -- otherwise any org
    // admin could grant themselves (or an accomplice) a privileged
    // internal role just by inviting that email with that roleKey.
    if (input.roleKey && INTERNAL_ROLE_KEYS.has(input.roleKey)) {
      throw new SomnusError(
        ErrorCode.FORBIDDEN,
        "This role cannot be assigned through an organization invitation.",
        {
          correlationId: "invitations",
          details: { roleKey: input.roleKey },
        },
      );
    }

    let roleId: UUIDv7 | undefined;
    if (input.roleKey) {
      const role = await this.roles.findByKey(input.roleKey);
      roleId = role?.id;
    }

    const { id, token } = await this.invitations.create({
      organizationId,
      email: input.email,
      ...(roleId ? { roleId } : {}),
      invitedBy: actorId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });

    return {
      invitation: {
        id,
        organizationId,
        email: input.email,
        ...(input.roleKey ? { roleKey: input.roleKey } : {}),
        status: "pending",
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
      },
      token,
    };
  }

  /**
   * Single-use (build plan §20 Checkpoint 6.3): the repository's
   * accept() only flips status when it is still "pending", so a
   * replayed token is rejected here, not silently re-processed.
   */
  async accept(actorId: UUIDv7, token: string): Promise<Invitation> {
    const invitation = await this.invitations.findByToken(token);
    if (!invitation) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Invitation not found.", {
        correlationId: "invitations",
      });
    }

    const accepted = await this.invitations.accept(token);
    if (!accepted) {
      throw new SomnusError(
        ErrorCode.CONFLICT,
        "This invitation has already been used or is no longer valid.",
        {
          correlationId: "invitations",
        },
      );
    }

    await this.memberships.create({ organizationId: invitation.organizationId, userId: actorId });

    if (invitation.roleId) {
      await this.roleAssignments.assign({
        userId: actorId,
        roleId: invitation.roleId,
        organizationId: invitation.organizationId,
        assignedBy: invitation.invitedBy,
      });
    }

    return toInvitation({ ...invitation, status: "accepted" });
  }
}
