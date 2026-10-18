import { Inject, Injectable } from "@nestjs/common";
import {
  type StaffInvitationPendingResponse,
  StaffInvitationPendingResponseSchema,
  UserResolveResponseSchema,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { type SessionRecord, SessionService } from "../sessions/session.service.js";

/**
 * The invited person's side of a staff invitation. Both the address and the
 * sign-in identity come from the verified session -- never from the request --
 * so nobody can look up, or accept, an invitation addressed to someone else.
 */
@Injectable()
export class StaffInvitationService {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly sessions: SessionService,
  ) {}

  async pending(
    session: SessionRecord | undefined,
    rawCorrelationId?: string,
  ): Promise<StaffInvitationPendingResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const active = requireSession(session, correlationId);
    if (!active.email) return { invitation: null };
    const response = await this.identity.post("/internal/v1/staff-invitations/pending", {
      correlationId,
      body: { email: active.email },
    });
    const parsed = StaffInvitationPendingResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    return parsed.data;
  }

  async accept(session: SessionRecord | undefined, rawCorrelationId?: string): Promise<void> {
    const correlationId = correlationOf(rawCorrelationId);
    const active = requireSession(session, correlationId);
    if (!active.email) {
      throw new SomnusError(ErrorCode.VALIDATION_FAILED, "A verified email is required.", {
        correlationId,
      });
    }
    const response = await this.identity.post("/internal/v1/staff-invitations/accept", {
      correlationId,
      body: { providerUserId: active.firebaseUid, email: active.email },
    });
    const parsed = UserResolveResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    // The session now belongs to a Somnus account: the console's next
    // /admin/v1/me resolves straight to it.
    await this.sessions.setSomnusUserId(active.sessionId, parsed.data.userId);
  }
}
