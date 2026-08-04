import { Inject, Injectable } from "@nestjs/common";
import {
  type MeResponse,
  MeResponseSchema,
  type RegistrationRequest,
  UserResolveResponseSchema,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { type SessionRecord, SessionService } from "../sessions/session.service.js";

/**
 * Registration (build plan §20 Checkpoint 9.1): turn an authenticated
 * Firebase identity into a Somnus user. The Firebase provider id and
 * email come from the verified session (never the client), so the SPA
 * only supplies the individual-profile fields. edge-api calls identity's
 * internal provision endpoint (idempotent find-or-create), memoizes the
 * resulting Somnus user id on the session, then returns the composed
 * `/v1/me` so the SPA can render immediately.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly sessions: SessionService,
  ) {}

  async register(
    session: SessionRecord | undefined,
    body: RegistrationRequest,
    rawCorrelationId?: string,
  ): Promise<MeResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const active = requireSession(session, correlationId);
    if (!active.email) {
      throw new SomnusError(ErrorCode.VALIDATION_FAILED, "A verified email is required.", {
        correlationId,
      });
    }

    const provisionResponse = await this.identity.post("/internal/v1/users/provision", {
      correlationId,
      body: {
        providerUserId: active.firebaseUid,
        email: active.email,
        firstName: body.firstName,
        lastName: body.lastName,
        ...(body.locale ? { locale: body.locale } : {}),
      },
    });
    const provisioned = UserResolveResponseSchema.safeParse(provisionResponse.body);
    if (!provisioned.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }

    const actorId = provisioned.data.userId;
    await this.sessions.setSomnusUserId(active.sessionId, actorId);

    const meResponse = await this.identity.get("/v1/me", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
    });
    const me = MeResponseSchema.safeParse(meResponse.body);
    if (!me.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    return me.data;
  }
}
