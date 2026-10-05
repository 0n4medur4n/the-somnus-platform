import { Inject, Injectable } from "@nestjs/common";
import { type MeResponse, MeResponseSchema, type ProfilePatchRequest } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import {
  IDENTITY_CLIENT,
  MORPHEO_CLIENT,
} from "../../infrastructure/internal-clients/internal-clients.module.js";
import {
  PROFILE_PHOTO_STORE,
  type ProfilePhotoStore,
  type StoredPhoto,
} from "../../infrastructure/storage/profile-photo-store.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import { type SessionRecord, SessionService } from "../sessions/session.service.js";
import { inspectProfilePhoto } from "./profile-photo.js";

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
    @Inject(MORPHEO_CLIENT) private readonly morpheo: CloudRunClient,
    private readonly actorResolver: ActorResolver,
    private readonly sessions: SessionService,
    @Inject(PROFILE_PHOTO_STORE) private readonly photos: ProfilePhotoStore,
  ) {}

  private actorOf(session: SessionRecord | undefined, correlationId: string): Promise<string> {
    return this.actorResolver.resolve(requireSession(session, correlationId), correlationId);
  }

  /**
   * Stores the photo under the person's own id, then tells identity there is
   * one. The bytes never reach identity; only the fact that a photo exists.
   */
  async setPhoto(
    session: SessionRecord | undefined,
    bytes: unknown,
    declaredType: string,
    rawCorrelationId?: string,
  ): Promise<void> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorOf(session, correlationId);
    if (!Buffer.isBuffer(bytes)) {
      throw new SomnusError(ErrorCode.VALIDATION_FAILED, "A WebP or JPEG image is required.", {
        correlationId,
      });
    }
    const inspection = inspectProfilePhoto(bytes, declaredType);
    if (!inspection.ok) {
      throw new SomnusError(ErrorCode.VALIDATION_FAILED, "The photo was not accepted.", {
        correlationId,
        details: { reason: inspection.reason },
      });
    }
    await this.photos.put(actorId, { bytes, type: inspection.type });
    await this.identity.put("/v1/me/profile/photo", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body: { present: true },
    });
  }

  /** The person's own photo, or NOT_FOUND. */
  async getPhoto(
    session: SessionRecord | undefined,
    rawCorrelationId?: string,
  ): Promise<StoredPhoto> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorOf(session, correlationId);
    const photo = await this.photos.get(actorId);
    if (!photo) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No profile photo.", { correlationId });
    }
    return photo;
  }

  async removePhoto(session: SessionRecord | undefined, rawCorrelationId?: string): Promise<void> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorOf(session, correlationId);
    await this.photos.remove(actorId);
    await this.identity.put("/v1/me/profile/photo", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body: { present: false },
    });
  }

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

  /**
   * Account deletion (build plan §21 / Checkpoint 13.2, right to erasure). The
   * edge orchestrates: erase the user's assessments in Morpheo, erase the profile
   * photo from edge-api's own bucket, erase the identity account (and its
   * isolated consent), then revoke the session so the cookie dies immediately.
   * Each service owns and erases its own data (§7).
   */
  async deleteAccount(
    session: SessionRecord | undefined,
    rawCorrelationId?: string,
  ): Promise<void> {
    const correlationId = correlationOf(rawCorrelationId);
    const record = requireSession(session, correlationId);
    const actorId = await this.actorResolver.resolve(record, correlationId);

    await this.morpheo.post("/internal/v1/maintenance/user-assessments/delete", {
      correlationId,
      body: { userId: actorId },
    });
    await this.photos.remove(actorId);
    await this.identity.delete("/v1/me", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
    });
    await this.sessions.revoke(record.sessionId);
  }
}
