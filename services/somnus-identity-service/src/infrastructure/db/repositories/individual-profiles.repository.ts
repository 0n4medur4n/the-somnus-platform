import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { individualProfiles } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

/** The registration role branch chosen at sign-up (Addendum A §A1, Checkpoint 14.1). */
export type RegistrationRole = (typeof individualProfiles.registrationRole.enumValues)[number];
/** Morpheo's pediatric age bands (§14a `roles[].age_bands`), set only on the guardian branch. */
export type MinorAgeBand = (typeof individualProfiles.minorAgeBand.enumValues)[number];

export type NewIndividualProfile = UserScope & {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  phone?: string;
  /**
   * Null for profiles created before the role branch existed, and for any
   * path that provisions a profile without going through registration.
   * `guardianshipConfirmed` / `minorAgeBand` are only ever non-null on the
   * `parent` branch -- never inferred, never defaulted.
   */
  registrationRole?: RegistrationRole | null;
  guardianshipConfirmed?: boolean | null;
  minorAgeBand?: MinorAgeBand | null;
};

export type ProfilePatch = Partial<Pick<NewIndividualProfile, "firstName" | "lastName" | "phone">>;

/** Every method takes a UserScope: this is profile data that belongs to exactly one user. */
export class IndividualProfilesRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewIndividualProfile): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(individualProfiles).values({
      id,
      userId: input.userId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      phone: input.phone,
      registrationRole: input.registrationRole,
      guardianshipConfirmed: input.guardianshipConfirmed,
      minorAgeBand: input.minorAgeBand,
    });
    return id;
  }

  async findByUser(scope: UserScope) {
    const rows = await this.db
      .select()
      .from(individualProfiles)
      .where(eq(individualProfiles.userId, scope.userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async patch(scope: UserScope, patch: ProfilePatch): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.db
      .update(individualProfiles)
      .set(patch)
      .where(eq(individualProfiles.userId, scope.userId));
  }
}
