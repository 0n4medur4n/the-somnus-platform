import { Injectable } from "@nestjs/common";
import type { UserProvisionRequest, UserResolveResponse } from "@somnus/api-contracts";
import { IndividualProfilesRepository } from "../../infrastructure/db/repositories/individual-profiles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";

/**
 * Registration provisioning (build plan §20 Checkpoint 9.1): find-or-
 * create the Somnus user behind a Firebase identity and create its
 * individual profile. Called by edge-api's `POST /v1/registration`
 * after the session (and thus the Firebase identity) is established.
 *
 * Idempotent: if the provider id is already linked, the existing user
 * is returned untouched -- re-registration and double-submits are
 * no-ops, never duplicate users or an error. This is the one write path
 * that turns a Firebase account into a Somnus account; the read path
 * (`resolve`) never creates anything.
 */
@Injectable()
export class UsersProvisionService {
  constructor(
    private readonly users: UsersRepository,
    private readonly individualProfiles: IndividualProfilesRepository,
  ) {}

  async provision(input: UserProvisionRequest): Promise<UserResolveResponse> {
    const existing = await this.users.findByProviderUserId(input.providerUserId);
    if (existing) {
      const user = await this.users.findById(existing.userId);
      if (user) {
        return { userId: user.id, email: user.email, locale: user.locale, status: user.status };
      }
    }

    const locale = input.locale ?? "es";
    const userId = await this.users.create({ email: input.email, locale });
    await this.users.linkIdentity({ userId, providerUserId: input.providerUserId });
    await this.individualProfiles.create({
      userId,
      firstName: input.firstName,
      lastName: input.lastName,
    });

    return { userId, email: input.email, locale, status: "active" };
  }
}
