import { Injectable } from "@nestjs/common";
import type { Organization, OrganizationCreateRequest, UUIDv7 } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { OrganizationsRepository } from "../../infrastructure/db/repositories/organizations.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { RoleAssignmentsRepository } from "../../infrastructure/db/repositories/role-assignments.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { RolesRepository } from "../../infrastructure/db/repositories/roles.repository.js";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly roles: RolesRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /** The creator becomes the first member, with the organization_owner role -- the standard bootstrap, not a privilege escalation. */
  async create(actorId: UUIDv7, input: OrganizationCreateRequest): Promise<Organization> {
    const id = await this.organizations.create({ name: input.name });
    await this.memberships.create({ organizationId: id, userId: actorId });

    const ownerRole = await this.roles.findByKey("organization_owner");
    if (ownerRole) {
      await this.roleAssignments.assign({
        userId: actorId,
        roleId: ownerRole.id,
        organizationId: id,
        assignedBy: actorId,
      });
    }

    return { id, name: input.name, status: "active" };
  }

  async getById(organizationId: UUIDv7): Promise<Organization> {
    const org = await this.organizations.findById(organizationId);
    if (!org) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Organization not found.", {
        correlationId: "organizations",
      });
    }
    return { id: org.id, name: org.name, status: org.status };
  }

  async update(
    actorId: UUIDv7,
    organizationId: UUIDv7,
    patch: Partial<Pick<Organization, "name" | "status">>,
  ): Promise<Organization> {
    await this.assertManageAllowed(actorId, organizationId);
    await this.organizations.update(organizationId, patch);
    return this.getById(organizationId);
  }

  private async assertManageAllowed(actorId: UUIDv7, organizationId: UUIDv7): Promise<void> {
    const decision = await this.authorizationService.check({
      actorUserId: actorId,
      subjectUserId: actorId,
      action: "manage_organization",
      organizationId,
    });
    if (!decision.allowed) {
      throw new SomnusError(ErrorCode.FORBIDDEN, "Not allowed to manage this organization.", {
        correlationId: "organizations",
        details: { reasonCode: decision.reasonCode },
      });
    }
  }
}
