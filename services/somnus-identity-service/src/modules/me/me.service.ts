import { Injectable } from "@nestjs/common";
import type { MeResponse, ProfilePatchRequest, UUIDv7 } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { IndividualProfilesRepository } from "../../infrastructure/db/repositories/individual-profiles.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { ProfessionalProfilesRepository } from "../../infrastructure/db/repositories/professional-profiles.repository.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";

@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly individualProfiles: IndividualProfilesRepository,
    private readonly professionalProfiles: ProfessionalProfilesRepository,
  ) {}

  async getMe(userId: UUIDv7): Promise<MeResponse> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "User not found.", { correlationId: "me" });
    }

    const [individual, professional] = await Promise.all([
      this.individualProfiles.findByUser({ userId }),
      this.professionalProfiles.findByUser({ userId }),
    ]);

    return {
      user: { id: user.id, email: user.email, locale: user.locale, status: user.status },
      individualProfile: individual
        ? {
            firstName: individual.firstName,
            lastName: individual.lastName,
            ...(individual.dateOfBirth ? { dateOfBirth: individual.dateOfBirth } : {}),
            ...(individual.phone ? { phone: individual.phone } : {}),
          }
        : null,
      professionalProfile: professional
        ? {
            specialty: professional.specialty,
            licenseNumber: professional.licenseNumber,
            verificationStatus: professional.verificationStatus,
          }
        : null,
    };
  }

  /** Individual-profile fields only -- license/specialty go through verification, not a plain patch. */
  async patchProfile(userId: UUIDv7, patch: ProfilePatchRequest): Promise<void> {
    const existing = await this.individualProfiles.findByUser({ userId });
    if (!existing) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Individual profile not found.", {
        correlationId: "me",
      });
    }
    // Zod's .optional() types a field as `T | undefined`, not merely
    // absent; exactOptionalPropertyTypes then rejects passing that
    // straight through to a plain `field?: T` target. Re-build the
    // patch with only the keys actually present.
    await this.individualProfiles.patch(
      { userId },
      {
        ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      },
    );
  }
}
