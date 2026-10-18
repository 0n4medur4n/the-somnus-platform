import { Inject, Injectable } from "@nestjs/common";
import { UserResolveResponseSchema } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { type SessionRecord, SessionService } from "./session.service.js";

/**
 * Resolves the internal Somnus user id that edge-api must forward to
 * private services as `x-somnus-actor-id` (build plan §20 Checkpoint
 * 8.2). The session only carries the Firebase identity; the mapping to
 * a Somnus user lives in identity, so edge-api asks identity's internal
 * resolve endpoint -- and memoizes the answer on the session so each
 * session pays that round-trip at most once.
 *
 * A Firebase user with no linked Somnus account surfaces as the
 * NOT_FOUND that identity returns (mapped by the cloud-run client),
 * propagated unchanged so `/v1/me` is a clean 404 rather than a 500.
 */
@Injectable()
export class ActorResolver {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly sessions: SessionService,
  ) {}

  async resolve(session: SessionRecord, correlationId: string): Promise<string> {
    if (session.somnusUserId) return session.somnusUserId;

    const response = await this.identity.post("/internal/v1/users/resolve", {
      body: { providerUserId: session.firebaseUid },
      correlationId,
    });

    const parsed = UserResolveResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", {
        correlationId,
      });
    }

    await this.sessions.setSomnusUserId(session.sessionId, parsed.data.userId);
    // Also on THIS request's session object: handlers after the guard read
    // `session.somnusUserId`, and the store write above only reaches the next
    // request. Without it, the first admin request of a fresh session called
    // identity with an empty actor id (401/400) once the guard had let it in.
    session.somnusUserId = parsed.data.userId;
    return parsed.data.userId;
  }
}
