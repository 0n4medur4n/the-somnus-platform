import { Inject, Injectable } from "@nestjs/common";
import {
  makeEvent,
  type PlatformInvitation,
  type PlatformInvitationAcceptInternalRequest,
  type PlatformInvitationCreateRequest,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
import {
  type PlatformInvitationRow,
  PlatformInvitationsRepository,
} from "../../infrastructure/db/repositories/platform-invitations.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";
import { ConsentService } from "../consent/consent.service.js";

function present(row: PlatformInvitationRow): PlatformInvitation {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    role: row.role,
    locale: row.locale,
    invitedBy: row.invitedBy,
    status:
      row.status === "pending" && row.expiresAt.getTime() <= Date.now() ? "expired" : row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class PlatformInvitationsService {
  constructor(
    private readonly invitations: PlatformInvitationsRepository,
    private readonly users: UsersRepository,
    private readonly authorization: AuthorizationService,
    private readonly consent: ConsentService,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  private async authorize(actorUserId: string) {
    const decision = await this.authorization.checkAdminCapability({
      actorUserId,
      capability: "admin_users_invite",
    });
    if (!decision.allowed)
      throw new SomnusError(ErrorCode.FORBIDDEN, "Invitation issuer is not authorized.", {
        correlationId: "platform-invitation",
      });
  }

  async create(actorId: string, request: PlatformInvitationCreateRequest) {
    await this.authorize(actorId);
    const target = await this.users.findByEmail(request.email);
    const actor = await this.users.findById(actorId);
    const recoverable =
      target?.status === "suspended" ? await this.invitations.recoverable(request.email) : null;
    if (
      target?.status === "deleted" ||
      (target?.status === "suspended" && recoverable?.preparedUserId !== target.id) ||
      actor?.email.toLowerCase() === request.email
    ) {
      throw new SomnusError(ErrorCode.FORBIDDEN, "Cannot invite this account.", {
        correlationId: "platform-invitation",
      });
    }
    return present(await this.invitations.create(request, actorId));
  }

  async list(actorId: string) {
    await this.authorize(actorId);
    return { invitations: (await this.invitations.list()).map(present) };
  }
  async revoke(actorId: string, invitationId: string) {
    await this.authorize(actorId);
    if (!(await this.invitations.revoke(invitationId)))
      throw new SomnusError(ErrorCode.INVITATION_NOT_FOUND, "No pending invitation.", {
        correlationId: "platform-invitation",
      });
  }

  async lookup(invitationId: string, email: string) {
    const row = await this.invitations.find(invitationId);
    if (!row || row.email !== email.trim().toLowerCase() || row.status === "revoked")
      throw new SomnusError(ErrorCode.INVITATION_NOT_FOUND, "Invitation not found.", {
        correlationId: "platform-invitation",
      });
    if (row.status === "accepted")
      throw new SomnusError(ErrorCode.INVITATION_ALREADY_USED, "Invitation already used.", {
        correlationId: "platform-invitation",
      });
    if (row.expiresAt.getTime() <= Date.now())
      throw new SomnusError(ErrorCode.INVITATION_EXPIRED, "Invitation expired.", {
        correlationId: "platform-invitation",
      });
    await this.authorize(row.invitedBy);
    return present(row);
  }

  async accept(input: PlatformInvitationAcceptInternalRequest, correlationId: string) {
    const invitation = await this.lookup(input.invitationId, input.email);
    if (input.registration && input.registration.role !== invitation.role)
      throw new SomnusError(
        ErrorCode.VALIDATION_FAILED,
        "Registration branch does not match invitation.",
        { correlationId },
      );
    const account = await this.invitations.prepare(input, input.registration);
    if (account.prepared && input.registration) {
      // Recoverable across the isolated Consent boundary: a failed receipt leaves
      // the account suspended and the invitation pending; retry records only missing purposes.
      const status = await this.consent.getStatus(account.userId);
      const purposes = [
        "terms_acceptance",
        "privacy_policy_acknowledgement",
        ...(input.registration.consents.marketing === true ? ["marketing" as const] : []),
      ] as const;
      for (const purposeKey of purposes) {
        if (!status.purposes.some((p) => p.purposeKey === purposeKey && p.consented && p.current)) {
          await this.consent.record({
            userId: account.userId,
            request: { purposeKey, source: "platform_invitation", locale: account.locale },
            correlationId,
          });
        }
      }
    }
    await this.authorize(invitation.invitedBy);
    await this.invitations.complete({ ...input, ...account });
    await this.events.publish(
      makeEvent({
        eventType: "identity.platform_invitation.accepted.v1",
        producer: "somnus-identity-service",
        correlationId,
        actor: { type: "user", id: account.userId },
        subject: { type: "platform_invitation", id: input.invitationId },
        data: { invitationId: input.invitationId },
      }),
    );
    return {
      userId: account.userId,
      email: input.email,
      locale: account.locale,
      status: "active" as const,
    };
  }
}
