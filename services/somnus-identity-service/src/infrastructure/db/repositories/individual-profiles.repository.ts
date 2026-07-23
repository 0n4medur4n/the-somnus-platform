import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { individualProfiles } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

export type NewIndividualProfile = UserScope & {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  phone?: string;
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
