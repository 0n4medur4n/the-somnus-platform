import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq } from "drizzle-orm";
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

  /**
   * The verifier queue (Addendum A §A2.2 `admin_verification_queue`), joined to
   * the profile so a verifier sees what they are actually verifying: the
   * specialty and the licence number. Deliberately not UserScope -- the queue is
   * a cross-user work list, which is what the capability gates.
   *
   * Carries no clinical data. Verifying a licence never requires it.
   */
  async listOpenVerificationCases(limit: number) {
    return this.db
      .select({
        caseId: professionalVerificationCases.id,
        professionalProfileId: professionalVerificationCases.professionalProfileId,
        status: professionalVerificationCases.status,
        openedAt: professionalVerificationCases.createdAt,
        userId: professionalProfiles.userId,
        specialty: professionalProfiles.specialty,
        licenseNumber: professionalProfiles.licenseNumber,
      })
      .from(professionalVerificationCases)
      .innerJoin(
        professionalProfiles,
        eq(professionalVerificationCases.professionalProfileId, professionalProfiles.id),
      )
      .where(eq(professionalVerificationCases.status, "pending"))
      .orderBy(professionalVerificationCases.createdAt)
      .limit(limit + 1);
  }

  async findVerificationCase(caseId: UUIDv7) {
    const rows = await this.db
      .select({
        caseId: professionalVerificationCases.id,
        professionalProfileId: professionalVerificationCases.professionalProfileId,
        status: professionalVerificationCases.status,
        openedAt: professionalVerificationCases.createdAt,
        userId: professionalProfiles.userId,
        specialty: professionalProfiles.specialty,
        licenseNumber: professionalProfiles.licenseNumber,
      })
      .from(professionalVerificationCases)
      .innerJoin(
        professionalProfiles,
        eq(professionalVerificationCases.professionalProfileId, professionalProfiles.id),
      )
      .where(eq(professionalVerificationCases.id, caseId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Resolves a case. Only ever from `pending`, so two verifiers racing the same
   * case cannot both record a decision -- the second one gets no rows and the
   * service turns that into a conflict rather than overwriting the first.
   */
  async resolveVerificationCase(input: {
    caseId: UUIDv7;
    status: "approved" | "rejected";
    reviewerId: UUIDv7;
    notes: string;
  }): Promise<boolean> {
    const result = await this.db
      .update(professionalVerificationCases)
      .set({
        status: input.status,
        reviewerId: input.reviewerId,
        reviewedAt: new Date(),
        notes: input.notes,
      })
      .where(
        and(
          eq(professionalVerificationCases.id, input.caseId),
          eq(professionalVerificationCases.status, "pending"),
        ),
      );
    return (result[0].affectedRows ?? 0) > 0;
  }

  async listVerificationCases(professionalProfileId: UUIDv7) {
    return this.db
      .select()
      .from(professionalVerificationCases)
      .where(eq(professionalVerificationCases.professionalProfileId, professionalProfileId));
  }
}
