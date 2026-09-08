import { Inject, Injectable } from "@nestjs/common";
import { INTERNAL_ROLE_KEYS, makeEvent, type RoleKey, type UUIDv7 } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { RoleAssignmentsRepository } from "../../infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";

/**
 * Where an internal-role grant came from.
 *
 * `console` is a `platform_super_admin` acting in the admin console
 * (Addendum A §A2.2: the only role that may assign internal roles).
 * `bootstrap` is the one-time platform bootstrap that creates the very first
 * super admin (§A5.4) -- there is no prior admin, so there is no acting admin.
 */
export type RoleAssignmentSource =
  | { kind: "console"; actingAdminUserId: UUIDv7 }
  | { kind: "bootstrap" };

export type InternalRoleAssignmentResult = {
  assignmentId: UUIDv7;
  targetUserId: UUIDv7;
  roleKey: RoleKey;
  source: RoleAssignmentSource["kind"];
};

/**
 * The single path by which an internal role is granted (Addendum A Checkpoint
 * 15.2). Both the console and the bootstrap script go through here; nothing
 * writes `role_assignments` for an internal role directly.
 *
 * That matters because the invariants below have to hold no matter who is
 * calling. Authorization -- whether the caller may be here at all -- is decided
 * before this, by the capability guard against §A2.2. This enforces what must
 * be true even for a caller who is permitted.
 */
@Injectable()
export class InternalRolesService {
  constructor(
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async assignInternalRole(input: {
    targetUserId: UUIDv7;
    roleKey: RoleKey;
    source: RoleAssignmentSource;
    correlationId: string;
  }): Promise<InternalRoleAssignmentResult> {
    const { targetUserId, roleKey, source, correlationId } = input;

    // 1. This path grants INTERNAL roles only. External roles are earned
    //    through registration, verification and invitations, never handed out.
    if (!INTERNAL_ROLE_KEYS.has(roleKey)) {
      throw new SomnusError(
        ErrorCode.FORBIDDEN,
        "Only internal roles are assigned through the admin console.",
        { correlationId, details: { roleKey } },
      );
    }

    // 2. The immutable negative from Checkpoint 6.3, extended to the admin
    //    routes exactly as Addendum A Checkpoint 15.2 requires: a super admin
    //    may not grant themselves anything. Escalation has to pass through a
    //    second person. The bootstrap has no acting admin, so the rule has
    //    nothing to compare and does not apply -- see the source guard below,
    //    which is what constrains that path instead.
    if (source.kind === "console" && source.actingAdminUserId === targetUserId) {
      throw new SomnusError(
        ErrorCode.FORBIDDEN,
        "An administrator cannot assign a privileged role to themselves.",
        { correlationId, details: { roleKey } },
      );
    }

    const role = await this.roles.findByKey(roleKey);
    if (!role) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Unknown role.", { correlationId });
    }

    // 3. The bootstrap may only ever create the FIRST super admin. Once anyone
    //    holds it, this path is refused forever -- so the script left in the
    //    repository is not a standing backdoor, it is a door that closed.
    if (source.kind === "bootstrap") {
      if (roleKey !== "platform_super_admin") {
        throw new SomnusError(
          ErrorCode.FORBIDDEN,
          "The bootstrap may only grant platform_super_admin.",
          { correlationId, details: { roleKey } },
        );
      }
      if (await this.roleAssignments.hasAnyActiveHolder(role.id)) {
        throw new SomnusError(
          ErrorCode.CONFLICT,
          "A platform_super_admin already exists; use the admin console.",
          { correlationId },
        );
      }
    }

    // 4. The target must be a real, active account. The bootstrap explicitly
    //    does NOT create one: the person signs up through the normal
    //    magic-link flow first, so the account is one they control.
    const target = await this.users.findById(targetUserId);
    if (!target) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such user.", { correlationId });
    }
    if (target.status !== "active") {
      throw new SomnusError(
        ErrorCode.CONFLICT,
        "A suspended or deleted account cannot hold an internal role.",
        { correlationId, details: { status: target.status } },
      );
    }

    // 5. Not already held.
    const held = await this.roleAssignments.listActiveForUser({ userId: targetUserId });
    if (held.some((assignment) => assignment.roleId === role.id)) {
      throw new SomnusError(ErrorCode.CONFLICT, "This user already holds that role.", {
        correlationId,
        details: { roleKey },
      });
    }

    const assignmentId = await this.roleAssignments.assign({
      userId: targetUserId,
      roleId: role.id,
      assignedBy: source.kind === "console" ? source.actingAdminUserId : null,
    });

    await this.emitAssigned({ assignmentId, targetUserId, roleKey, source, correlationId });

    return { assignmentId, targetUserId, roleKey, source: source.kind };
  }

  /** The internal roles a user currently holds. External roles are not listed. */
  async listInternalRoles(targetUserId: UUIDv7): Promise<RoleKey[]> {
    const held = await this.roleAssignments.listActiveForUser({ userId: targetUserId });
    if (held.length === 0) return [];
    const rows = await this.roles.findManyByIds(held.map((assignment) => assignment.roleId));
    return rows.map((row) => row.key).filter((key) => INTERNAL_ROLE_KEYS.has(key));
  }

  /**
   * The domain event for the grant itself, distinct from the edge's record that
   * an admin called a route. `source` is what makes a bootstrap grant visibly
   * different from an in-console one when the audit log is read later -- which
   * is the whole point of recording it (§A5.4).
   *
   * Unlike the funnel events, this one is NOT swallowed on failure: an internal
   * role granted without an audit trail is worse than a failed grant.
   */
  private async emitAssigned(input: {
    assignmentId: UUIDv7;
    targetUserId: UUIDv7;
    roleKey: RoleKey;
    source: RoleAssignmentSource;
    correlationId: string;
  }): Promise<void> {
    await this.events.publish(
      makeEvent({
        eventType: "admin.internal_role.assigned.v1",
        producer: "somnus-identity-service",
        correlationId: input.correlationId,
        ...(input.source.kind === "console"
          ? { actor: { type: "user", id: input.source.actingAdminUserId } }
          : {}),
        subject: { type: "user", id: input.targetUserId },
        data: {
          assignmentId: input.assignmentId,
          roleKey: input.roleKey,
          source: input.source.kind,
        },
      }),
    );
  }
}
