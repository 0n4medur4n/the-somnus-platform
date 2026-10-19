import { Inject, Injectable } from "@nestjs/common";
import { PlatformInvitationSchema, UserResolveResponseSchema } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { type SessionRecord, SessionService } from "../sessions/session.service.js";
import type { AcceptDto, LookupDto } from "./platform-invitation.dto.js";
@Injectable()
export class PlatformInvitationService {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly sessions: SessionService,
  ) {}
  async act(
    session: SessionRecord | undefined,
    body: LookupDto | AcceptDto,
    accept: boolean,
    rawCorrelationId?: string,
  ) {
    const correlationId = correlationOf(rawCorrelationId);
    const active = requireSession(session, correlationId);
    if (!active.email || active.emailVerified !== true)
      throw new SomnusError(ErrorCode.FORBIDDEN, "Verified address required.", { correlationId });
    const response = await this.identity.post(
      `/internal/v1/platform-invitations/${accept ? "accept" : "lookup"}`,
      {
        correlationId,
        body: { ...body, email: active.email, providerUserId: active.firebaseUid },
      },
    );
    if (!accept) return PlatformInvitationSchema.parse(response.body);
    const user = UserResolveResponseSchema.parse(response.body);
    await this.sessions.setSomnusUserId(active.sessionId, user.userId);
    return undefined;
  }
}
