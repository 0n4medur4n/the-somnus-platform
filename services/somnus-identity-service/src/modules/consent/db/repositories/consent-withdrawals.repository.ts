import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { ConsentDb } from "../consent-db.client.js";
import { consentWithdrawals } from "../schema/index.js";

export class ConsentWithdrawalsRepository {
  constructor(private readonly db: ConsentDb) {}

  /** `receiptId` is unique on the table -- a duplicate insert throws, which the service layer treats as "already withdrawn." */
  async create(input: { receiptId: UUIDv7; userId: UUIDv7; reason?: string }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(consentWithdrawals).values({ id, ...input });
    return id;
  }

  async findByReceiptId(receiptId: UUIDv7) {
    const rows = await this.db
      .select()
      .from(consentWithdrawals)
      .where(eq(consentWithdrawals.receiptId, receiptId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Account erasure (build plan §21 / 13.2): delete every withdrawal for a user. */
  async deleteByUserId(userId: UUIDv7): Promise<void> {
    await this.db.delete(consentWithdrawals).where(eq(consentWithdrawals.userId, userId));
  }
}
