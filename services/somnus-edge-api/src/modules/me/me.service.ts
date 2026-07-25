import { Inject, Injectable } from "@nestjs/common";
import { type MeResponse, MeResponseSchema, type ProfilePatchRequest } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import type { SessionRecord } from "../sessions/session.service.js";

/**
 * `/v1/me` composition (build plan §5.3 / §20 Checkpoint 8.2). edge-api
 * resolves the actor, forwards it plus the correlation id to the
 * private identity service, and returns the identity response. No
 * business logic and no database live here -- this is a BFF.
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly actorResolver: ActorResolver,
  ) {}

  async getMe(session: SessionRecord | undefined, rawCorrelationId?: string): Promise<MeResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorResolver.resolve(
      requireSession(session, correlationId),
      correlationId,
    );

    const response = await this.identity.get("/v1/me", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
    });

    const parsed = MeResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    return parsed.data;
  }

  async patchProfile(
    session: SessionRecord | undefined,
    body: ProfilePatchRequest,
    rawCorrelationId?: string,
  ): Promise<void> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorResolver.resolve(
      requireSession(session, correlationId),
      correlationId,
    );

    await this.identity.patch("/v1/me/profile", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body,
    });
  }
}
