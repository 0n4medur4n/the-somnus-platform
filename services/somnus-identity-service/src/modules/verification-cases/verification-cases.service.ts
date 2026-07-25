import { Injectable } from "@nestjs/common";
import type { UUIDv7, VerificationCase } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { ProfessionalProfilesRepository } from "../../infrastructure/db/repositories/professional-profiles.repository.js";

@Injectable()
export class VerificationCasesService {
  constructor(private readonly professionalProfiles: ProfessionalProfilesRepository) {}

  /** Opens a new verification case for the actor's own professional profile. */
  async openForActor(actorId: UUIDv7): Promise<VerificationCase> {
    const profile = await this.professionalProfiles.findByUser({ userId: actorId });
    if (!profile) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Professional profile not found.", {
        correlationId: "verification-cases",
      });
    }
    const id = await this.professionalProfiles.openVerificationCase(profile.id);
    return { id, professionalProfileId: profile.id, status: "pending" };
  }

  async listForActor(actorId: UUIDv7): Promise<VerificationCase[]> {
    const profile = await this.professionalProfiles.findByUser({ userId: actorId });
    if (!profile) return [];
    const rows = await this.professionalProfiles.listVerificationCases(profile.id);
    return rows.map((row) => ({
      id: row.id,
      professionalProfileId: row.professionalProfileId,
      status: row.status,
      ...(row.reviewerId ? { reviewerId: row.reviewerId } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
    }));
  }
}
