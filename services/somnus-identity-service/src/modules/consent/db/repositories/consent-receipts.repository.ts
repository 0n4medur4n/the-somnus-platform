import { UUIDv7 } from "@somnus/api-contracts";
import { and, desc, eq } from "drizzle-orm";
import type { ConsentDb } from "../consent-db.client.js";
import { consentReceipts } from "../schema/index.js";
import type { ConsentPurposeKeyRow } from "./consent-purposes.repository.js";

export type UserScope = { userId: UUIDv7 };

export class ConsentReceiptsRepository {
  constructor(private readonly db: ConsentDb) {}

  async create(input: {
    userId: UUIDv7;
    purposeKey: ConsentPurposeKeyRow;
    legalDocumentVersionId: UUIDv7;
    organizationId?: UUIDv7;
    source: string;
  }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(consentReceipts).values({ id, ...input });
    return id;
  }

  async findById(scope: UserScope & { receiptId: UUIDv7 }) {
    const rows = await this.db
      .select()
      .from(consentReceipts)
      .where(and(eq(consentReceipts.userId, scope.userId), eq(consentReceipts.id, scope.receiptId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The most recent receipt for this purpose determines current
   * standing (grant, withdrawal, supersession). Ordered by `id`, not
   * `consentedAt`: `consented_at` is a whole-second `timestamp`
   * column, so two receipts created in the same second tie and sort
   * arbitrarily. UUIDv7 embeds a millisecond-precision timestamp and
   * is lexicographically sortable by construction (see
   * packages/api-contracts/src/uuid.ts) -- ordering by `id` is
   * strictly more correct here, not just a workaround.
   */
  async findLatestForPurpose(scope: UserScope & { purposeKey: ConsentPurposeKeyRow }) {
    const rows = await this.db
      .select()
      .from(consentReceipts)
      .where(
        and(
          eq(consentReceipts.userId, scope.userId),
          eq(consentReceipts.purposeKey, scope.purposeKey),
        ),
      )
      .orderBy(desc(consentReceipts.id))
      .limit(1);
    return rows[0] ?? null;
  }
}
