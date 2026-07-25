import { Injectable } from "@nestjs/common";
import type { UserResolveResponse } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";

/**
 * Build plan §20 Checkpoint 8.2: edge-api verifies the Firebase session
 * and must forward the resolved *internal* Somnus user id as
 * `x-somnus-actor-id`. Edge-api has no database (build plan §5.3), so
 * the Firebase-provider-id -> Somnus-user-id mapping is resolved here,
 * over the internal-only boundary, against the identity database.
 *
 * Resolve-only: a Firebase account with no linked Somnus user is a
 * NOT_FOUND, never an auto-provision. Provisioning (linking a provider
 * id to a new user row) belongs to the registration flow, not to this
 * read path, so a session can exist for a Firebase user who has no
 * Somnus account yet -- they simply cannot compose `/v1/me` until
 * registered.
 */
@Injectable()
export class UsersResolveService {
  constructor(private readonly users: UsersRepository) {}

  async resolveByProvider(providerUserId: string): Promise<UserResolveResponse> {
    const link = await this.users.findByProviderUserId(providerUserId);
    if (!link) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No Somnus account for this identity.", {
        correlationId: "users-resolve",
      });
    }
    const user = await this.users.findById(link.userId);
    if (!user) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No Somnus account for this identity.", {
        correlationId: "users-resolve",
      });
    }
    return { userId: user.id, email: user.email, locale: user.locale, status: user.status };
  }
}
