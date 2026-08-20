import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { ConsentReceiptsRepository } from "../../../src/modules/consent/db/repositories/consent-receipts.repository.js";
import { ConsentWithdrawalsRepository } from "../../../src/modules/consent/db/repositories/consent-withdrawals.repository.js";
import { getConsentTestDb, resetConsentTables } from "../consent-db-test-helper.js";

describe("consent erasure (account deletion, §13.2)", () => {
  const db = getConsentTestDb();
  const receipts = new ConsentReceiptsRepository(db);
  const withdrawals = new ConsentWithdrawalsRepository(db);

  beforeEach(async () => {
    await resetConsentTables();
  });

  it("deletes a user's consent receipts and withdrawals", async () => {
    const userId = UUIDv7();
    const receiptId = await receipts.create({
      userId,
      purposeKey: "terms_acceptance",
      legalDocumentVersionId: UUIDv7(),
      source: "test",
    });
    await withdrawals.create({ receiptId, userId });

    await withdrawals.deleteByUserId(userId);
    await receipts.deleteByUserId(userId);

    expect(
      await receipts.findLatestForPurpose({ userId, purposeKey: "terms_acceptance" }),
    ).toBeNull();
    expect(await withdrawals.findByReceiptId(receiptId)).toBeNull();
  });
});
