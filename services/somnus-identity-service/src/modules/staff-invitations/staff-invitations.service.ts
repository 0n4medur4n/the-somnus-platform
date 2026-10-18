import { Inject, Injectable } from "@nestjs/common";
import {
  makeEvent,
  STAFF_INVITATION_TTL_DAYS,
  type StaffInvitation,
  type StaffInvitationAcceptInternalRequest,
  type StaffInvitationCreateRequest,
  type StaffInvitationListResponse,
  type StaffInvitationPendingResponse,
  type UserResolveResponse,
  type UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import {
  type StaffInvitationRow,
  StaffInvitationsRepository,
} from "../../infrastructure/db/repositories/staff-invitations.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";
import { InternalRolesService } from "../admin/internal-roles.service.js";
import { ConsentService } from "../consent/consent.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many invitations the console lists; it is a staff list, not a user table. */
const LIST_LIMIT = 100;

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function toStaffInvitation(row: StaffInvitationRow, now: Date): StaffInvitation {
  const expired = row.status === "pending" && row.expiresAt.getTime() <= now.getTime();
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    roleKey: row.roleKey,
    locale: row.locale,
    status: expired ? "expired" : row.status,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
  };
}

/**
 * Staff invitations (owner decision 2026-10-18; contract in
 * `@somnus/api-contracts` `identity/staff-invitation.ts`).
 *
 * The admin side (create, list, revoke) is gated at the edge on
 * `admin_roles_assign` -- an invitation grants an internal role, so it is held
 * to the same gate as granting one directly. The invitee side (pending, accept)
 * only ever sees the address the session verified.
 *
 * No account exists until the invited person accepts. The role is then granted
 * through `InternalRolesService` -- the single path for internal roles -- on
 * behalf of the admin who invited, so every invariant there (internal roles
 * only, never to oneself, active accounts only) holds here too.
 */
@Injectable()
export class StaffInvitationsService {
  constructor(
    private readonly invitations: StaffInvitationsRepository,
    private readonly users: UsersRepository,
    private readonly internalRoles: InternalRolesService,
    // The Consent module's public interface only (build plan §261).
    private readonly consent: ConsentService,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async create(
    actorId: UUIDv7,
    input: StaffInvitationCreateRequest,
    correlationId: string,
  ): Promise<StaffInvitation> {
    const actor = await this.users.findById(actorId);
    // Granting yourself a role by inviting your own address is the same
    // escalation InternalRolesService refuses; refuse it here, before any email.
    if (!actor || sameAddress(actor.email, input.email)) {
      throw new SomnusError(ErrorCode.FORBIDDEN, "An administrator cannot invite themselves.", {
        correlationId,
      });
    }
    const row = await this.invitations.replacePending({
      email: input.email.trim().toLowerCase(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      roleKey: input.roleKey,
      locale: input.locale,
      invitedBy: actorId,
      expiresAt: new Date(Date.now() + STAFF_INVITATION_TTL_DAYS * DAY_MS),
    });
    return toStaffInvitation(row, new Date());
  }

  async list(): Promise<StaffInvitationListResponse> {
    const now = new Date();
    const rows = await this.invitations.listRecent(LIST_LIMIT);
    return { invitations: rows.map((row) => toStaffInvitation(row, now)) };
  }

  async revoke(invitationId: string, correlationId: string): Promise<StaffInvitation> {
    if (!(await this.invitations.revoke(invitationId))) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No pending invitation with that id.", {
        correlationId,
      });
    }
    const row = await this.invitations.findById(invitationId);
    if (!row) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such invitation.", { correlationId });
    }
    return toStaffInvitation(row, new Date());
  }

  /** What the address was invited as, for the accept screen. */
  async pending(email: string): Promise<StaffInvitationPendingResponse> {
    const row = await this.invitations.findUsableByEmail(email.trim().toLowerCase(), new Date());
    if (!row) return { invitation: null };
    return {
      invitation: {
        firstName: row.firstName,
        roleKey: row.roleKey,
        expiresAt: row.expiresAt.toISOString(),
      },
    };
  }

  /**
   * The invited person accepts. `email` is the address the session verified
   * and `providerUserId` the identity it verified -- edge passes both from the
   * session, never from the request body.
   */
  async accept(
    input: StaffInvitationAcceptInternalRequest,
    correlationId: string,
  ): Promise<UserResolveResponse> {
    const now = new Date();
    const email = input.email.trim().toLowerCase();
    const invitation = await this.invitations.findUsableByEmail(email, now);
    if (!invitation) {
      throw new SomnusError(ErrorCode.INVITATION_NOT_FOUND, "Invitation not found.", {
        correlationId,
      });
    }

    let userId: UUIDv7;
    const linked = await this.users.findByProviderUserId(input.providerUserId);
    if (linked) {
      // Someone who already uses the platform with this address: the role is
      // added to the account they already control.
      const user = await this.users.findById(linked.userId as UUIDv7);
      if (!user || !sameAddress(user.email, email)) {
        throw new SomnusError(
          ErrorCode.INVITATION_EMAIL_MISMATCH,
          "This invitation was issued to a different email address.",
          { correlationId },
        );
      }
      userId = user.id as UUIDv7;
    } else {
      if (await this.users.findByEmail(email)) {
        // The address has an account under a different sign-in identity. Linking
        // it here would hand that account to whoever holds this sign-in.
        throw new SomnusError(
          ErrorCode.CONFLICT,
          "This address already has an account under another sign-in.",
          { correlationId },
        );
      }
      userId = await this.users.create({ email, locale: invitation.locale });
      await this.users.linkIdentity({ userId, providerUserId: input.providerUserId });
    }

    if (!(await this.invitations.markAccepted(invitation.id, userId, now))) {
      throw new SomnusError(
        ErrorCode.INVITATION_ALREADY_USED,
        "This invitation has already been used.",
        { correlationId },
      );
    }

    // The privacy acknowledgement the accept screen asked for, as a receipt.
    await this.consent.record({
      userId,
      request: {
        purposeKey: "privacy_policy_acknowledgement",
        source: "staff_invitation",
        locale: invitation.locale,
      },
      correlationId,
    });

    await this.internalRoles.assignInternalRole({
      targetUserId: userId,
      roleKey: invitation.roleKey,
      source: { kind: "console", actingAdminUserId: invitation.invitedBy as UUIDv7 },
      correlationId,
    });

    await this.emitAccepted(invitation.id, userId, correlationId);

    const user = await this.users.findById(userId);
    return {
      userId,
      email,
      locale: user?.locale ?? invitation.locale,
      status: user?.status ?? "active",
    };
  }

  /** Never blocks the acceptance; carries no name or address. */
  private async emitAccepted(invitationId: string, userId: string, correlationId: string) {
    try {
      await this.events.publish(
        makeEvent({
          eventType: "identity.staff_invitation.accepted.v1",
          producer: "somnus-identity-service",
          correlationId,
          subject: { type: "staff_invitation", id: invitationId },
          data: { invitationId, userId },
        }),
      );
    } catch {
      // Deliberately swallowed: see the method doc.
    }
  }
}
