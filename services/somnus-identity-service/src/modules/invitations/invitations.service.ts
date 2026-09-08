import { Inject, Injectable } from "@nestjs/common";
import {
  INTERNAL_ROLE_KEYS,
  type Invitation,
  type InvitationCreateRequest,
  type InvitationCreateResponse,
  type InvitationPreviewResponse,
  makeEvent,
  type UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
import { OrganizationInvitationsRepository } from "../../infrastructure/db/repositories/organization-invitations.repository.js";
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";
import { OrganizationsRepository } from "../../infrastructure/db/repositories/organizations.repository.js";
import { RoleAssignmentsRepository } from "../../infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";

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

/**
 * Email equality for invitation binding. Case-insensitive: the address was
 * typed by an org admin and is compared against the one Firebase verified,
 * and no mail provider in practice treats those as different mailboxes.
 */
function emailsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: OrganizationInvitationsRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    private readonly authorizationService: AuthorizationService,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
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

    // Opens the Nox invitation funnel (Addendum A §A2.4). The invited address
    // is never carried: the opaque invitation id is what lets the funnel count
    // distinct invitations across stages.
    await this.emit("identity.organization.invitation.created.v1", actorId, id);

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
   * Pre-login lookup for the accept flow (Addendum A Checkpoint 14.2).
   * Unauthenticated by necessity: Nox has no public signup, so the invited
   * person must be told which organization invited them -- and whether the
   * invitation is still usable -- before they have any session at all.
   * The token is the capability; it was mailed to the invited address.
   */
  async preview(token: string): Promise<InvitationPreviewResponse> {
    const invitation = await this.requireUsableInvitation(token, "preview");

    await this.emit("identity.organization.invitation.previewed.v1", invitation.id, invitation.id);

    const organization = await this.organizations.findById(invitation.organizationId);
    if (!organization) {
      // An invitation whose organization no longer exists is dead, and is
      // reported the same way as a token that never existed.
      throw new SomnusError(ErrorCode.INVITATION_NOT_FOUND, "Invitation not found.", {
        correlationId: "invitations",
      });
    }

    return {
      organizationName: organization.name,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Single-use (build plan §20 Checkpoint 6.3) and time-limited: the
   * repository's accept() only flips status when it is still "pending", and
   * requireUsableInvitation() below rejects an expired token before that.
   *
   * The invitation is also bound to the address it was mailed to: holding the
   * token is not enough, the accepting session must BE that person. Without
   * this, a leaked or forwarded token would let any account join the
   * organization -- which is exactly the membership path Addendum A §A1 says
   * must not exist outside a valid invitation.
   */
  async accept(actorId: UUIDv7, token: string): Promise<Invitation> {
    const invitation = await this.requireUsableInvitation(token, "accept");

    const actor = await this.users.findById(actorId);
    if (!actor || !emailsMatch(actor.email, invitation.email)) {
      throw new SomnusError(
        ErrorCode.INVITATION_EMAIL_MISMATCH,
        "This invitation was issued to a different email address.",
        { correlationId: "invitations" },
      );
    }

    const accepted = await this.invitations.accept(token);
    if (!accepted) {
      // Lost a race with a concurrent accept: the row was still "pending"
      // a moment ago, so by now someone else has used it.
      throw new SomnusError(
        ErrorCode.INVITATION_ALREADY_USED,
        "This invitation has already been used.",
        { correlationId: "invitations" },
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

    await this.emit("identity.organization.invitation.accepted.v1", actorId, invitation.id);

    return toInvitation({ ...invitation, status: "accepted" });
  }

  /**
   * The single place that decides whether a token may be used, so preview and
   * accept can never disagree about it. Each failure carries its own stable
   * code: the invited person is told which thing went wrong, and the accept
   * screen never falls back to open registration (Addendum A Checkpoint 14.2).
   */
  private async requireUsableInvitation(token: string, stage: "preview" | "accept") {
    const invitation = await this.invitations.findByToken(token);
    if (!invitation) {
      throw new SomnusError(ErrorCode.INVITATION_NOT_FOUND, "Invitation not found.", {
        correlationId: "invitations",
      });
    }

    if (invitation.status === "accepted") {
      throw new SomnusError(
        ErrorCode.INVITATION_ALREADY_USED,
        "This invitation has already been used.",
        { correlationId: "invitations" },
      );
    }

    // A withdrawn invitation is deliberately indistinguishable from one that
    // never existed: the org admin revoked it, and the recipient has no claim
    // to learn that it once existed or who issued it.
    if (invitation.status === "revoked") {
      throw new SomnusError(ErrorCode.INVITATION_NOT_FOUND, "Invitation not found.", {
        correlationId: "invitations",
      });
    }

    // The status column is only advisory here -- nothing sweeps `pending` rows
    // to `expired` on a timer, so the expiry timestamp is the authority. This
    // check is what stops a months-old token from still being accepted.
    if (invitation.status === "expired" || invitation.expiresAt.getTime() <= Date.now()) {
      // Recorded where the refusal actually happens, so the funnel counts an
      // expiry someone ran into rather than a row a sweeper wrote later.
      await this.emit("identity.organization.invitation.expired.v1", invitation.id, invitation.id, {
        stage,
      });
      throw new SomnusError(ErrorCode.INVITATION_EXPIRED, "This invitation has expired.", {
        correlationId: "invitations",
      });
    }

    return invitation;
  }

  /**
   * Analytics emission never blocks the invitation flow. The payload is the
   * `.strict()` contract in `packages/api-contracts/src/analytics`: an opaque
   * invitation id and, for an expiry, which stage refused it. Never the invited
   * email address, never the organization name.
   */
  private async emit(
    eventType: string,
    correlationId: string,
    invitationId: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.events.publish(
        makeEvent({
          eventType,
          producer: "somnus-identity-service",
          correlationId,
          subject: { type: "invitation", id: invitationId },
          data: { invitationId, ...extra },
        }),
      );
    } catch {
      // Deliberately swallowed: see the method doc.
    }
  }
}
