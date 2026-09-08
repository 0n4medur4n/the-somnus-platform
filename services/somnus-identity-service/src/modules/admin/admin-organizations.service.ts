import { Injectable } from "@nestjs/common";
import type {
  AdminOrganizationMember,
  AdminOrganizationSummary,
  UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { AuditRepository } from "../../infrastructure/db/repositories/audit.repository.js";
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";
import { OrganizationsRepository } from "../../infrastructure/db/repositories/organizations.repository.js";

/**
 * Organizations for the admin console (Addendum A Checkpoint 15.2, capability
 * `admin_organizations_manage`).
 *
 * Creating an organization here is the platform-admin path §A1 describes:
 * "Created by a platform admin in the admin console **or** by a verified
 * professional requesting an organization". Unlike the self-service path, the
 * admin who creates one does NOT become its owner -- an operator setting up an
 * organization for a customer must not silently join it.
 */
@Injectable()
export class AdminOrganizationsService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(limit: number): Promise<AdminOrganizationSummary[]> {
    const rows = await this.organizations.listForAdmin(limit);
    return rows.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async create(name: string): Promise<AdminOrganizationSummary> {
    const id = await this.organizations.create({ name });
    const created = await this.organizations.findById(id);
    if (!created) {
      throw new SomnusError(ErrorCode.INTERNAL, "The organization was not persisted.", {
        correlationId: "admin-organizations",
      });
    }
    // Deliberately no membership: see the class doc.
    return {
      id: created.id,
      name: created.name,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Approve (activate) or suspend. The reason is mandatory: suspending an
   * organization cuts every one of its members off at once, and that is not
   * something to do without a recorded why.
   */
  async setStatus(input: {
    organizationId: UUIDv7;
    status: "active" | "suspended";
    reason: string;
    actingAdminUserId: UUIDv7;
  }): Promise<AdminOrganizationSummary> {
    const organization = await this.organizations.findById(input.organizationId);
    if (!organization) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such organization.", {
        correlationId: "admin-organizations",
      });
    }
    if (organization.status === input.status) {
      throw new SomnusError(ErrorCode.CONFLICT, "The organization is already in that state.", {
        correlationId: "admin-organizations",
        details: { status: organization.status },
      });
    }

    await this.organizations.update(input.organizationId, { status: input.status });
    // Recorded against the acting admin, not against a user: the subject here
    // is the organization, and the console's audit event carries that.
    await this.audit.recordStatusChange({
      userId: input.actingAdminUserId,
      previousStatus: `organization:${organization.status}`,
      newStatus: `organization:${input.status}`,
      reason: input.reason,
      changedBy: input.actingAdminUserId,
    });

    return {
      id: organization.id,
      name: organization.name,
      status: input.status,
      createdAt: organization.createdAt.toISOString(),
    };
  }

  /** The roster, by opaque user id. Names and addresses are the user screen's job. */
  async members(organizationId: UUIDv7): Promise<AdminOrganizationMember[]> {
    const rows = await this.memberships.listMembers({ organizationId });
    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.userId,
      status: row.status,
    }));
  }
}
