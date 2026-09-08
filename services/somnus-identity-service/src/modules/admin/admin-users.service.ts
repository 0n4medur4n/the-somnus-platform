import { Injectable } from "@nestjs/common";
import type {
  AdminDeletionDecisionRequest,
  AdminDeletionRequest,
  AdminUserDetail,
  AdminUserSearchRequest,
  AdminUserSearchResponse,
  UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { AccountDeletionRepository } from "../../infrastructure/db/repositories/account-deletion.repository.js";
import { AuditRepository } from "../../infrastructure/db/repositories/audit.repository.js";
import { IndividualProfilesRepository } from "../../infrastructure/db/repositories/individual-profiles.repository.js";
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";
import { ProfessionalProfilesRepository } from "../../infrastructure/db/repositories/professional-profiles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import { AccountDeletionService } from "../account/account-deletion.service.js";
import { InternalRolesService } from "./internal-roles.service.js";

/**
 * Users and deletion requests for the admin console (Addendum A Checkpoint
 * 15.2, capabilities `admin_users_read`, `admin_account_status_write`,
 * `admin_deletion_requests_process`).
 *
 * §A2.3 governs every shape returned here: this is administrative access, which
 * is not clinical access. An admin sees who someone is, what state their
 * account is in, and which organizations they belong to. Reaching an
 * assessment, an answer or a report needs break-glass -- a different
 * capability, with a justification, in Checkpoint 15.5.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly individualProfiles: IndividualProfilesRepository,
    private readonly professionalProfiles: ProfessionalProfilesRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly audit: AuditRepository,
    private readonly deletion: AccountDeletionRepository,
    private readonly accountDeletion: AccountDeletionService,
    private readonly internalRoles: InternalRolesService,
  ) {}

  async search(filter: AdminUserSearchRequest): Promise<AdminUserSearchResponse> {
    const rows = await this.users.searchForAdmin({
      ...(filter.email !== undefined ? { email: filter.email } : {}),
      ...(filter.status !== undefined ? { status: filter.status } : {}),
      limit: filter.limit,
    });

    // The repository fetched limit + 1 so a full page and a truncated one are
    // distinguishable; the console tells the admin to narrow rather than
    // silently omitting people.
    const truncated = rows.length > filter.limit;
    return {
      users: rows.slice(0, filter.limit).map((row) => ({
        id: row.id,
        email: row.email,
        locale: row.locale,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      truncated,
    };
  }

  async detail(userId: UUIDv7): Promise<AdminUserDetail> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such user.", { correlationId: "admin-users" });
    }

    const [individual, professional, memberships, internalRoles] = await Promise.all([
      this.individualProfiles.findByUser({ userId }),
      this.professionalProfiles.findByUser({ userId }),
      this.memberships.listMembershipsForUser(userId),
      this.internalRoles.listInternalRoles(userId),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        locale: user.locale,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      },
      individualProfile: individual
        ? {
            firstName: individual.firstName,
            lastName: individual.lastName,
            registrationRole: individual.registrationRole ?? null,
          }
        : null,
      professionalProfile: professional
        ? {
            specialty: professional.specialty,
            verificationStatus: professional.verificationStatus,
          }
        : null,
      internalRoles,
      organizationIds: memberships.map((m) => m.organizationId),
    };
  }

  /**
   * Suspend or reactivate. Never "delete": erasure is irreversible and goes
   * through the deletion-request path, which is a separate capability and a
   * separate, auditable act.
   *
   * The reason is mandatory and is written to `account_status_history` with the
   * acting admin. Locking someone out of their own health data without a
   * recorded reason is not an operation this platform offers.
   */
  async setAccountStatus(input: {
    targetUserId: UUIDv7;
    status: "active" | "suspended";
    reason: string;
    actingAdminUserId: UUIDv7;
  }): Promise<void> {
    const user = await this.users.findById(input.targetUserId);
    if (!user) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such user.", { correlationId: "admin-users" });
    }
    if (user.status === "deleted") {
      throw new SomnusError(ErrorCode.CONFLICT, "A deleted account cannot be reinstated.", {
        correlationId: "admin-users",
      });
    }
    if (user.status === input.status) {
      throw new SomnusError(ErrorCode.CONFLICT, "The account is already in that state.", {
        correlationId: "admin-users",
        details: { status: user.status },
      });
    }

    await this.users.setStatus(input.targetUserId, input.status);
    await this.audit.recordStatusChange({
      userId: input.targetUserId,
      previousStatus: user.status,
      newStatus: input.status,
      reason: input.reason,
      changedBy: input.actingAdminUserId,
    });
  }

  async listDeletionRequests(limit: number): Promise<AdminDeletionRequest[]> {
    const rows = await this.deletion.listPendingRequests(limit);
    return rows.slice(0, limit).map((row) => ({
      id: row.id,
      userId: row.userId,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    }));
  }

  /**
   * Completing a deletion request runs the same erasure the user's own
   * `DELETE /v1/me` runs (Checkpoint 13.2) -- identity data plus the isolated
   * Consent module, with the audit trail retained. There is no second,
   * admin-only erasure path that could drift from it.
   */
  async decideDeletionRequest(input: {
    requestId: UUIDv7;
    decision: AdminDeletionDecisionRequest["decision"];
    reason: string;
    actingAdminUserId: UUIDv7;
  }): Promise<void> {
    const request = await this.deletion.findRequest(input.requestId);
    if (!request) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such deletion request.", {
        correlationId: "admin-users",
      });
    }

    const resolved = await this.deletion.resolveRequest(
      input.requestId,
      input.decision === "complete" ? "completed" : "cancelled",
    );
    if (!resolved) {
      // Another admin resolved it first; do not erase on the strength of a
      // stale screen.
      throw new SomnusError(ErrorCode.CONFLICT, "This request has already been resolved.", {
        correlationId: "admin-users",
      });
    }

    await this.audit.recordStatusChange({
      userId: request.userId,
      previousStatus: "pending_deletion",
      newStatus: input.decision === "complete" ? "deleted" : "active",
      reason: input.reason,
      changedBy: input.actingAdminUserId,
    });

    if (input.decision === "complete") {
      await this.accountDeletion.eraseAccount(request.userId);
    }
  }
}
