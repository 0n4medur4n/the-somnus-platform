import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { ConsentDb } from "../consent-db.client.js";
import { type consentPurposeKeys, consentPurposes } from "../schema/index.js";

export type ConsentPurposeKeyRow = (typeof consentPurposeKeys)[number];

/** Reference/catalog table, not user-scoped -- same rationale as identity's RolesRepository. */
export class ConsentPurposesRepository {
  constructor(private readonly db: ConsentDb) {}

  async seedPurpose(input: {
    key: ConsentPurposeKeyRow;
    name: string;
    isRequired: boolean;
  }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(consentPurposes).values({ id, ...input });
    return id;
  }

  async findByKey(key: ConsentPurposeKeyRow) {
    const rows = await this.db
      .select()
      .from(consentPurposes)
      .where(eq(consentPurposes.key, key))
      .limit(1);
    return rows[0] ?? null;
  }
}
