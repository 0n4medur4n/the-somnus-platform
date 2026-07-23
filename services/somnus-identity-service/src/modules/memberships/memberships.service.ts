import { Injectable } from "@nestjs/common";
import type { Membership, MembershipPatchRequest, UUIDv7 } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";

@Injectable()
export class MembershipsService {
  constructor(
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async list(actorId: UUIDv7, organizationId: UUIDv7): Promise<Membership[]> {
    await this.assertAllowed(actorId, organizationId, "read_administrative_data");
    const rows = await this.memberships.listMembers({ organizationId });
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      status: row.status,
    }));
  }

  async patch(
    actorId: UUIDv7,
    organizationId: UUIDv7,
    membershipId: UUIDv7,
    patch: MembershipPatchRequest,
  ): Promise<Membership> {
    await this.assertAllowed(actorId, organizationId, "manage_organization");

    const existing = await this.memberships.findMembership({ organizationId, membershipId });
    if (!existing) {
      throw new SomnusError(ErrorCode.ORGANIZATION_MEMBERSHIP_NOT_FOUND, "Membership not found.", {
        correlationId: "memberships",
      });
    }

    await this.memberships.setStatus({ organizationId, membershipId }, patch.status);
    return { id: existing.id, organizationId, userId: existing.userId, status: patch.status };
  }

  private async assertAllowed(
    actorId: UUIDv7,
    organizationId: UUIDv7,
    action: "read_administrative_data" | "manage_organization",
  ): Promise<void> {
    const decision = await this.authorizationService.check({
      actorUserId: actorId,
      subjectUserId: actorId,
      action,
      organizationId,
    });
    if (!decision.allowed) {
      throw new SomnusError(ErrorCode.FORBIDDEN, "Not allowed for this organization.", {
        correlationId: "memberships",
        details: { reasonCode: decision.reasonCode },
      });
    }
  }
}
