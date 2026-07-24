import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { ConsentAuditRepository } from "../../../src/modules/consent/db/repositories/consent-audit.repository.js";
import { ConsentPurposesRepository } from "../../../src/modules/consent/db/repositories/consent-purposes.repository.js";
import { ConsentReceiptsRepository } from "../../../src/modules/consent/db/repositories/consent-receipts.repository.js";
import { ConsentWithdrawalsRepository } from "../../../src/modules/consent/db/repositories/consent-withdrawals.repository.js";
import { LegalDocumentsRepository } from "../../../src/modules/consent/db/repositories/legal-documents.repository.js";
import { getConsentTestDb, resetConsentTables } from "../consent-db-test-helper.js";

describe("ConsentPurposesRepository", () => {
  const repo = new ConsentPurposesRepository(getConsentTestDb());

  it("finds a purpose seeded by migration 0001_seed_consent_purposes (build plan §13 catalog)", async () => {
    const found = await repo.findByKey("health_data_processing");
    expect(found?.isRequired).toBe(true);
  });

  it("returns null for a purpose that does not exist", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately probing an invalid enum value at runtime
    expect(await repo.findByKey("nope" as any)).toBeNull();
  });
});

describe("LegalDocumentsRepository", () => {
  const repo = new LegalDocumentsRepository(getConsentTestDb());

  it("finds the seeded document for a purpose", async () => {
    const found = await repo.findByPurposeKey("marketing");
    expect(found?.purposeKey).toBe("marketing");
  });

  it("findCurrentVersion returns the highest version for that document+locale", async () => {
    // CI runs this suite repeatedly against one persistent TiDB cluster
    // (build plan §20 Checkpoint 6.3's CI setup) -- legal_document_versions
    // is permanent reference data, never reset between test runs. A
    // hardcoded "starts at 1, bumps to 2" would collide on the second
    // run ever since. Compute relative to whatever's already there instead.
    const document = await repo.findByPurposeKey("marketing");
    if (!document) throw new Error("seed missing");

    const before = await repo.findCurrentVersion(document.id, "es");
    const beforeVersion = before?.version ?? 0;

    await repo.publishVersion({
      legalDocumentId: document.id,
      version: beforeVersion + 1,
      locale: "es",
      content: `v${beforeVersion + 1} content`,
    });

    const current = await repo.findCurrentVersion(document.id, "es");
    expect(current?.version).toBe(beforeVersion + 1);
  });

  it("findLatestVersionNumber is locale-agnostic", async () => {
    const document = await repo.findByPurposeKey("professional_sharing");
    if (!document) throw new Error("seed missing");

    const beforeVersion = (await repo.findLatestVersionNumber(document.id)) ?? 0;

    await repo.publishVersion({
      legalDocumentId: document.id,
      version: beforeVersion + 1,
      locale: "en",
      content: `v${beforeVersion + 1} en content`,
    });

    // Published in "en", but the latest version NUMBER applies across locales.
    expect(await repo.findLatestVersionNumber(document.id)).toBe(beforeVersion + 1);
  });

  it("listCurrentVersionsForLocale returns one row per document with a version in that locale", async () => {
    const versions = await repo.listCurrentVersionsForLocale("es");
    expect(versions.length).toBe(6);
  });
});

describe("ConsentReceiptsRepository / ConsentWithdrawalsRepository", () => {
  const receipts = new ConsentReceiptsRepository(getConsentTestDb());
  const withdrawals = new ConsentWithdrawalsRepository(getConsentTestDb());
  const legalDocuments = new LegalDocumentsRepository(getConsentTestDb());

  beforeEach(async () => {
    await resetConsentTables();
  });

  it("findLatestForPurpose returns the most recently created receipt", async () => {
    const userId = UUIDv7();
    const document = await legalDocuments.findByPurposeKey("marketing");
    if (!document) throw new Error("seed missing");
    const version = await legalDocuments.findCurrentVersion(document.id, "es");
    if (!version) throw new Error("seed missing");

    await receipts.create({
      userId,
      purposeKey: "marketing",
      legalDocumentVersionId: version.id,
      source: "app",
    });
    const second = await receipts.create({
      userId,
      purposeKey: "marketing",
      legalDocumentVersionId: version.id,
      source: "app",
    });

    const latest = await receipts.findLatestForPurpose({ userId, purposeKey: "marketing" });
    expect(latest?.id).toBe(second);
  });

  it("a receipt is not withdrawn until a withdrawal row exists for it", async () => {
    const userId = UUIDv7();
    const document = await legalDocuments.findByPurposeKey("marketing");
    if (!document) throw new Error("seed missing");
    const version = await legalDocuments.findCurrentVersion(document.id, "es");
    if (!version) throw new Error("seed missing");

    const receiptId = await receipts.create({
      userId,
      purposeKey: "marketing",
      legalDocumentVersionId: version.id,
      source: "app",
    });

    expect(await withdrawals.findByReceiptId(receiptId)).toBeNull();
    await withdrawals.create({ receiptId, userId });
    expect(await withdrawals.findByReceiptId(receiptId)).not.toBeNull();
  });

  it("findById is scoped to the owning user", async () => {
    const owner = UUIDv7();
    const stranger = UUIDv7();
    const document = await legalDocuments.findByPurposeKey("marketing");
    if (!document) throw new Error("seed missing");
    const version = await legalDocuments.findCurrentVersion(document.id, "es");
    if (!version) throw new Error("seed missing");

    const receiptId = await receipts.create({
      userId: owner,
      purposeKey: "marketing",
      legalDocumentVersionId: version.id,
      source: "app",
    });

    expect(await receipts.findById({ userId: owner, receiptId })).not.toBeNull();
    expect(await receipts.findById({ userId: stranger, receiptId })).toBeNull();
  });
});

describe("ConsentAuditRepository", () => {
  const audit = new ConsentAuditRepository(getConsentTestDb());

  beforeEach(async () => {
    await resetConsentTables();
  });

  it("records and lists events for a user", async () => {
    const userId = UUIDv7();
    await audit.recordEvent({
      eventType: "consent.receipt.recorded",
      userId,
      purposeKey: "marketing",
    });

    const events = await audit.listEventsForUser(userId);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("consent.receipt.recorded");
  });
});
