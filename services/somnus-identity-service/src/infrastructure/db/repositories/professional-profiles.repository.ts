import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import {
  professionalCredentials,
  professionalProfiles,
  type professionalSpecialties,
  professionalVerificationCases,
} from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

export type ProfessionalSpecialty = (typeof professionalSpecialties)[number];

export type NewProfessionalProfile = UserScope & {
  specialty: ProfessionalSpecialty;
  licenseNumber: string;
};

export type NewCredential = {
  professionalProfileId: UUIDv7;
  credentialType: string;
  issuer: string;
  issuedAt?: string;
  expiresAt?: string;
  documentUrl?: string;
};

/**
 * Profile lookups are UserScope (build plan §8). Credentials and
 * verification cases hang off a professionalProfileId, which the
 * caller can only have obtained via a UserScope-guarded lookup first
 * -- so requiring it here still keeps the chain scoped end to end,
 * even though the guard test only mechanically checks the
 * directly-user/org-scoped tables (see tenant-scope-guard.test.ts).
 */
export class ProfessionalProfilesRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewProfessionalProfile): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(professionalProfiles).values({
      id,
      userId: input.userId,
      specialty: input.specialty,
      licenseNumber: input.licenseNumber,
    });
    return id;
  }

  async findByUser(scope: UserScope) {
    const rows = await this.db
      .select()
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, scope.userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Set directly by whoever resolves a verification case (build plan
   * §11 roles: professional_verifier, clinical_governance_reviewer).
   * No HTTP endpoint calls this yet in Checkpoint 6.2 -- verification
   * case *review* is out of this checkpoint's endpoint list, only
   * opening/listing cases is.
   */
  async setVerificationStatus(
    scope: UserScope,
    status: (typeof professionalProfiles.verificationStatus.enumValues)[number],
  ): Promise<void> {
    await this.db
      .update(professionalProfiles)
      .set({ verificationStatus: status })
      .where(eq(professionalProfiles.userId, scope.userId));
  }

  async addCredential(input: NewCredential): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(professionalCredentials).values({ id, ...input });
    return id;
  }

  async listCredentials(professionalProfileId: UUIDv7) {
    return this.db
      .select()
      .from(professionalCredentials)
      .where(eq(professionalCredentials.professionalProfileId, professionalProfileId));
  }

  async openVerificationCase(professionalProfileId: UUIDv7): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(professionalVerificationCases).values({ id, professionalProfileId });
    return id;
  }

  async listVerificationCases(professionalProfileId: UUIDv7) {
    return this.db
      .select()
      .from(professionalVerificationCases)
      .where(eq(professionalVerificationCases.professionalProfileId, professionalProfileId));
  }
}
