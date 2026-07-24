import type { EventEnvelope } from "@somnus/api-contracts";
import { UUIDv7 } from "@somnus/api-contracts";
import { SomnusError } from "@somnus/errors";
import { beforeEach, describe, expect, it } from "vitest";
import { ConsentService } from "../../../src/modules/consent/consent.service.js";
import { ConsentAuditRepository } from "../../../src/modules/consent/db/repositories/consent-audit.repository.js";
import { ConsentReceiptsRepository } from "../../../src/modules/consent/db/repositories/consent-receipts.repository.js";
import { ConsentWithdrawalsRepository } from "../../../src/modules/consent/db/repositories/consent-withdrawals.repository.js";
import { LegalDocumentsRepository } from "../../../src/modules/consent/db/repositories/legal-documents.repository.js";
import type { EventPublisher } from "../../../src/modules/consent/events/event-publisher.js";
import { getConsentTestDb, resetConsentTables } from "../consent-db-test-helper.js";

class RecordingEventPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];
  async publish(event: EventEnvelope): Promise<void> {
    this.published.push(event);
  }
}

describe("ConsentService", () => {
  const legalDocuments = new LegalDocumentsRepository(getConsentTestDb());
  const receipts = new ConsentReceiptsRepository(getConsentTestDb());
  const withdrawals = new ConsentWithdrawalsRepository(getConsentTestDb());
  const audit = new ConsentAuditRepository(getConsentTestDb());

  let eventPublisher: RecordingEventPublisher;
  let service: ConsentService;

  beforeEach(async () => {
    await resetConsentTables();
    eventPublisher = new RecordingEventPublisher();
    service = new ConsentService(legalDocuments, receipts, withdrawals, audit, eventPublisher);
  });

  describe("getCurrentLegalDocuments", () => {
    it("returns one entry per purpose in the requested locale", async () => {
      const result = await service.getCurrentLegalDocuments("es");
      expect(result.documents).toHaveLength(6);
      expect(result.documents.every((d) => d.locale === "es")).toBe(true);
    });

    it("silently omits a purpose with no legal document (defensive -- cannot happen via the fixed enum, but the lookup path is real)", async () => {
      const fakeLegalDocuments = {
        findByPurposeKey: async () => null,
        findCurrentVersion: async () => null,
      } as unknown as LegalDocumentsRepository;
      const bareService = new ConsentService(
        fakeLegalDocuments,
        receipts,
        withdrawals,
        audit,
        eventPublisher,
      );

      const result = await bareService.getCurrentLegalDocuments("es");
      expect(result.documents).toEqual([]);
    });
  });

  describe("record", () => {
    it("creates a receipt against the current document version and publishes consent.receipt.recorded.v1", async () => {
      const userId = UUIDv7();
      const receipt = await service.record({
        userId,
        request: { purposeKey: "marketing", source: "app" },
        correlationId: "corr-1",
      });

      expect(receipt.userId).toBe(userId);
      expect(receipt.purposeKey).toBe("marketing");

      expect(eventPublisher.published).toHaveLength(1);
      expect(eventPublisher.published[0]?.eventType).toBe("consent.receipt.recorded.v1");
      expect(eventPublisher.published[0]?.subject).toEqual({ type: "user", id: userId });
    });

    it("carries an organizationId through when the actor consents in an organization context", async () => {
      const userId = UUIDv7();
      const organizationId = UUIDv7();
      const receipt = await service.record({
        userId,
        request: { purposeKey: "professional_sharing", source: "app", organizationId },
        correlationId: "corr-1b",
      });

      expect(receipt.organizationId).toBe(organizationId);
    });

    it("throws NOT_FOUND for a purpose with no legal document (defensive -- cannot happen via the fixed enum, but the lookup path is real)", async () => {
      const userId = UUIDv7();
      await expect(
        service.record({
          userId,
          // biome-ignore lint/suspicious/noExplicitAny: deliberately probing an invalid purpose at the service boundary
          request: { purposeKey: "does_not_exist" as any, source: "app" },
          correlationId: "corr-2",
        }),
      ).rejects.toSatisfy((e: unknown) => e instanceof SomnusError && e.code === "NOT_FOUND");
    });

    it("throws NOT_FOUND for a document with no published version yet (defensive -- every seeded purpose has v1, but a new purpose could be added without content)", async () => {
      // All six real purposes are seeded with a document AND a v1
      // version by migration 0001, so this precondition (document
      // exists, version does not) can't be reached through the real
      // repositories -- a minimal fake stands in for just this one
      // lookup to exercise the defensive branch.
      const fakeLegalDocuments = {
        findByPurposeKey: async () => ({ id: UUIDv7(), purposeKey: "marketing", name: "x" }),
        findCurrentVersion: async () => null,
      } as unknown as LegalDocumentsRepository;
      const bareService = new ConsentService(
        fakeLegalDocuments,
        receipts,
        withdrawals,
        audit,
        eventPublisher,
      );

      await expect(
        bareService.record({
          userId: UUIDv7(),
          request: { purposeKey: "marketing", source: "app" },
          correlationId: "corr-2b",
        }),
      ).rejects.toSatisfy((e: unknown) => e instanceof SomnusError && e.code === "NOT_FOUND");
    });
  });

  describe("withdraw", () => {
    it("withdrawal is immediately visible to check() -- no caching, no delay (build plan §20 Checkpoint 7.1 time-sensitive test)", async () => {
      const userId = UUIDv7();
      const receipt = await service.record({
        userId,
        request: { purposeKey: "health_data_processing", source: "app" },
        correlationId: "corr-3",
      });

      const before = await service.check({ userId, purposeKey: "health_data_processing" });
      expect(before).toEqual({ consented: true, withdrawn: false });

      await service.withdraw({ userId, receiptId: receipt.id, correlationId: "corr-4" });

      // No sleep, no retry, no cache-bust call -- the very next check()
      // must already reflect the withdrawal.
      const after = await service.check({ userId, purposeKey: "health_data_processing" });
      expect(after).toEqual({ consented: false, withdrawn: true });
    });

    it("accepts an optional reason", async () => {
      const userId = UUIDv7();
      const receipt = await service.record({
        userId,
        request: { purposeKey: "marketing", source: "app" },
        correlationId: "corr-3b",
      });

      await expect(
        service.withdraw({
          userId,
          receiptId: receipt.id,
          reason: "no longer interested",
          correlationId: "corr-3c",
        }),
      ).resolves.toBeUndefined();
    });

    it("publishes consent.receipt.withdrawn.v1", async () => {
      const userId = UUIDv7();
      const receipt = await service.record({
        userId,
        request: { purposeKey: "marketing", source: "app" },
        correlationId: "corr-5",
      });
      await service.withdraw({ userId, receiptId: receipt.id, correlationId: "corr-6" });

      expect(eventPublisher.published.map((e) => e.eventType)).toEqual([
        "consent.receipt.recorded.v1",
        "consent.receipt.withdrawn.v1",
      ]);
    });

    it("rejects withdrawing the same receipt twice with CONFLICT", async () => {
      const userId = UUIDv7();
      const receipt = await service.record({
        userId,
        request: { purposeKey: "marketing", source: "app" },
        correlationId: "corr-7",
      });
      await service.withdraw({ userId, receiptId: receipt.id, correlationId: "corr-8" });

      await expect(
        service.withdraw({ userId, receiptId: receipt.id, correlationId: "corr-9" }),
      ).rejects.toSatisfy((e: unknown) => e instanceof SomnusError && e.code === "CONFLICT");
    });

    it("rejects withdrawing a receipt that belongs to someone else with NOT_FOUND", async () => {
      const owner = UUIDv7();
      const stranger = UUIDv7();
      const receipt = await service.record({
        userId: owner,
        request: { purposeKey: "marketing", source: "app" },
        correlationId: "corr-10",
      });

      await expect(
        service.withdraw({ userId: stranger, receiptId: receipt.id, correlationId: "corr-11" }),
      ).rejects.toSatisfy((e: unknown) => e instanceof SomnusError && e.code === "NOT_FOUND");
    });
  });

  describe("getStatus / version supersession", () => {
    it("a purpose never consented to shows consented=false, current=false, withdrawn=false", async () => {
      const userId = UUIDv7();
      const status = await service.getStatus(userId);
      const professionalSharing = status.purposes.find(
        (p) => p.purposeKey === "professional_sharing",
      );
      expect(professionalSharing).toEqual({
        purposeKey: "professional_sharing",
        consented: false,
        current: false,
        withdrawn: false,
      });
    });

    it("current=false (never true/error) when a receipt's document version no longer resolves (defensive -- cannot happen via record(), which always sets a real version id)", async () => {
      const userId = UUIDv7();
      const fakeReceipts = {
        findLatestForPurpose: async () => ({
          id: UUIDv7(),
          userId,
          purposeKey: "marketing",
          legalDocumentVersionId: UUIDv7(),
          source: "app",
          consentedAt: new Date(),
        }),
      } as unknown as ConsentReceiptsRepository;
      const bareService = new ConsentService(
        legalDocuments,
        fakeReceipts,
        withdrawals,
        audit,
        eventPublisher,
      );

      const status = await bareService.getStatus(userId);
      const marketing = status.purposes.find((p) => p.purposeKey === "marketing");
      expect(marketing?.current).toBe(false);
    });

    it("publishing a new document version marks an existing receipt as no longer current, without withdrawing it", async () => {
      const userId = UUIDv7();
      await service.record({
        userId,
        request: { purposeKey: "research_participation", source: "app" },
        correlationId: "corr-12",
      });

      const beforeStatus = await service.getStatus(userId);
      const beforePurpose = beforeStatus.purposes.find(
        (p) => p.purposeKey === "research_participation",
      );
      expect(beforePurpose?.consented).toBe(true);
      expect(beforePurpose?.current).toBe(true);

      // CI runs this suite repeatedly against one persistent TiDB cluster;
      // legal_document_versions is never reset between runs, so the next
      // version published must be computed relative to whatever's already
      // there, not a hardcoded number that would collide on a later run.
      const document = await legalDocuments.findByPurposeKey("research_participation");
      if (!document) throw new Error("seed missing");
      const nextVersion = ((await legalDocuments.findLatestVersionNumber(document.id)) ?? 0) + 1;
      await legalDocuments.publishVersion({
        legalDocumentId: document.id,
        version: nextVersion,
        locale: "es",
        content: "a newer version",
      });

      const afterStatus = await service.getStatus(userId);
      const afterPurpose = afterStatus.purposes.find(
        (p) => p.purposeKey === "research_participation",
      );
      // Still consented (never withdrawn) but no longer "current".
      expect(afterPurpose?.consented).toBe(true);
      expect(afterPurpose?.withdrawn).toBe(false);
      expect(afterPurpose?.current).toBe(false);
    });
  });

  describe("check", () => {
    it("returns consented=false, withdrawn=false for a user with no receipt at all", async () => {
      const userId = UUIDv7();
      expect(await service.check({ userId, purposeKey: "health_data_processing" })).toEqual({
        consented: false,
        withdrawn: false,
      });
    });
  });
});
