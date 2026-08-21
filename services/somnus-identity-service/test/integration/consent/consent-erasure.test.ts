import type { EventEnvelope } from "@somnus/api-contracts";
import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { ConsentService } from "../../../src/modules/consent/consent.service.js";
import { ConsentAuditRepository } from "../../../src/modules/consent/db/repositories/consent-audit.repository.js";
import { ConsentReceiptsRepository } from "../../../src/modules/consent/db/repositories/consent-receipts.repository.js";
import { ConsentWithdrawalsRepository } from "../../../src/modules/consent/db/repositories/consent-withdrawals.repository.js";
import { LegalDocumentsRepository } from "../../../src/modules/consent/db/repositories/legal-documents.repository.js";
import type { EventPublisher } from "../../../src/modules/consent/events/event-publisher.js";
import { getConsentTestDb, resetConsentTables } from "../consent-db-test-helper.js";

/** eraseUser publishes nothing; a no-op publisher keeps the wiring honest. */
class NoopEventPublisher implements EventPublisher {
  async publish(_event: EventEnvelope): Promise<void> {}
}

describe("consent erasure (account deletion, §13.2)", () => {
  const db = getConsentTestDb();
  const receipts = new ConsentReceiptsRepository(db);
  const withdrawals = new ConsentWithdrawalsRepository(db);
  const legalDocuments = new LegalDocumentsRepository(db);
  const audit = new ConsentAuditRepository(db);
  const service = new ConsentService(
    legalDocuments,
    receipts,
    withdrawals,
    audit,
    new NoopEventPublisher(),
  );

  beforeEach(async () => {
    await resetConsentTables();
  });

  it("ConsentService.eraseUser deletes a user's consent receipts and withdrawals", async () => {
    const userId = UUIDv7();
    const receiptId = await receipts.create({
      userId,
      purposeKey: "terms_acceptance",
      legalDocumentVersionId: UUIDv7(),
      source: "test",
    });
    await withdrawals.create({ receiptId, userId });

    // Erase through the module's public interface (identity reaches the isolated
    // consent database only through ConsentService -- ADR 0010), not the repos.
    await service.eraseUser(userId);

    expect(
      await receipts.findLatestForPurpose({ userId, purposeKey: "terms_acceptance" }),
    ).toBeNull();
    expect(await withdrawals.findByReceiptId(receiptId)).toBeNull();
  });
});
