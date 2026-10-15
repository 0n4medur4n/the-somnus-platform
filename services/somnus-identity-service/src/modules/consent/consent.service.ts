import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  CONSENT_PURPOSE_KEYS,
  type ConsentCheckRequest,
  type ConsentCheckResponse,
  type ConsentCreateRequest,
  type ConsentReceipt,
  type ConsentRecordsResponse,
  type ConsentStatus,
  type ConsentStatusListResponse,
  type CurrentLegalDocumentsResponse,
  DEFAULT_LOCALE,
  type LegalDocumentVersion,
  makeEvent,
  type SupportedLocale,
  type UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { ConsentAuditRepository } from "./db/repositories/consent-audit.repository.js";
import { ConsentReceiptsRepository } from "./db/repositories/consent-receipts.repository.js";
import { ConsentWithdrawalsRepository } from "./db/repositories/consent-withdrawals.repository.js";
import { LegalDocumentsRepository } from "./db/repositories/legal-documents.repository.js";
import { EVENT_PUBLISHER, type EventPublisher } from "./events/event-publisher.js";

type DocumentRow = { name: string; purposeKey: LegalDocumentVersion["purposeKey"] };
type VersionRow = {
  id: string;
  version: number;
  locale: LegalDocumentVersion["locale"];
  content: string;
  effectiveAt: Date;
};

/** The SHA-256 of a version's text exactly as stored -- what a receipt's copy is checked against. */
export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function toDocumentVersion(document: DocumentRow, version: VersionRow): LegalDocumentVersion {
  return {
    id: version.id,
    purposeKey: document.purposeKey,
    title: document.name,
    version: version.version,
    locale: version.locale,
    content: version.content,
    contentSha256: contentSha256(version.content),
    effectiveAt: version.effectiveAt.toISOString(),
  };
}

/**
 * The ONLY class outside `src/modules/consent/` may import (enforced
 * by `.dependency-cruiser.cjs`). Everything else in this folder --
 * repositories, schema, the DB connection, the event publisher -- is
 * consent-internal (build plan ADR 0010).
 *
 * No caching anywhere in this class: every method reads straight from
 * the repositories on every call. `check()` in particular must never
 * cache, since a withdrawal has to take effect on the very next call
 * (build plan §20 Checkpoint 7.1's time-sensitive test) -- there is no
 * cache-invalidation path to get right or wrong here, because there
 * is no cache.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly legalDocuments: LegalDocumentsRepository,
    private readonly receipts: ConsentReceiptsRepository,
    private readonly withdrawals: ConsentWithdrawalsRepository,
    private readonly audit: ConsentAuditRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async getCurrentLegalDocuments(
    locale: SupportedLocale = DEFAULT_LOCALE,
  ): Promise<CurrentLegalDocumentsResponse> {
    const documents: CurrentLegalDocumentsResponse["documents"] = [];
    for (const purposeKey of CONSENT_PURPOSE_KEYS) {
      const document = await this.legalDocuments.findByPurposeKey(purposeKey);
      if (!document) continue;
      const version = await this.legalDocuments.findCurrentVersion(document.id, locale);
      if (!version) continue;
      documents.push(toDocumentVersion(document, version));
    }
    return { documents };
  }

  /**
   * Every consent the user gave, newest first, each with the exact document
   * version it was given against (its text and fingerprint). Withdrawn ones
   * stay: withdrawing ends a consent, it does not unmake the fact it was given.
   */
  async listRecords(userId: UUIDv7): Promise<ConsentRecordsResponse> {
    const receipts = await this.receipts.listForUser({ userId });
    const records: ConsentRecordsResponse["receipts"] = [];
    for (const receipt of receipts) {
      const version = await this.legalDocuments.findVersionById(receipt.legalDocumentVersionId);
      const document = version ? await this.legalDocuments.findById(version.legalDocumentId) : null;
      if (!version || !document) continue;
      const withdrawal = await this.withdrawals.findByReceiptId(receipt.id);
      records.push({
        receiptId: receipt.id,
        purposeKey: receipt.purposeKey,
        source: receipt.source,
        consentedAt: receipt.consentedAt.toISOString(),
        ...(withdrawal ? { withdrawnAt: withdrawal.withdrawnAt.toISOString() } : {}),
        document: toDocumentVersion(document, version),
      });
    }
    return { receipts: records };
  }

  async getStatus(userId: UUIDv7): Promise<ConsentStatusListResponse> {
    const purposes: ConsentStatus[] = [];
    for (const purposeKey of CONSENT_PURPOSE_KEYS) {
      const receipt = await this.receipts.findLatestForPurpose({ userId, purposeKey });
      if (!receipt) {
        purposes.push({ purposeKey, consented: false, current: false, withdrawn: false });
        continue;
      }

      const withdrawal = await this.withdrawals.findByReceiptId(receipt.id);
      const withdrawn = withdrawal !== null;

      const version = await this.legalDocuments.findVersionById(receipt.legalDocumentVersionId);
      const latestVersion = version
        ? await this.legalDocuments.findLatestVersionNumber(version.legalDocumentId)
        : null;
      const current =
        version !== null && latestVersion !== null && version.version === latestVersion;

      purposes.push({
        purposeKey,
        consented: !withdrawn,
        current,
        withdrawn,
        receiptId: receipt.id,
        legalDocumentVersionId: receipt.legalDocumentVersionId,
        consentedAt: receipt.consentedAt.toISOString(),
      });
    }
    return { purposes };
  }

  async record(input: {
    userId: UUIDv7;
    request: ConsentCreateRequest;
    correlationId: string;
  }): Promise<ConsentReceipt> {
    const { userId, request, correlationId } = input;

    const document = await this.legalDocuments.findByPurposeKey(request.purposeKey);
    if (!document) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No legal document exists for this purpose.", {
        correlationId,
        details: { purposeKey: request.purposeKey },
      });
    }
    const version = await this.legalDocuments.findCurrentVersion(document.id, DEFAULT_LOCALE);
    if (!version) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No published version exists for this purpose.", {
        correlationId,
        details: { purposeKey: request.purposeKey },
      });
    }

    const receiptId = await this.receipts.create({
      userId,
      purposeKey: request.purposeKey,
      legalDocumentVersionId: version.id,
      ...(request.organizationId ? { organizationId: request.organizationId } : {}),
      source: request.source,
    });

    await this.audit.recordEvent({
      eventType: "consent.receipt.recorded",
      userId,
      purposeKey: request.purposeKey,
    });

    await this.eventPublisher.publish(
      makeEvent({
        eventType: "consent.receipt.recorded.v1",
        producer: "somnus-identity-service",
        correlationId,
        subject: { type: "user", id: userId },
        data: { receiptId, purposeKey: request.purposeKey, legalDocumentVersionId: version.id },
      }),
    );

    return {
      id: receiptId,
      userId,
      purposeKey: request.purposeKey,
      legalDocumentVersionId: version.id,
      ...(request.organizationId ? { organizationId: request.organizationId } : {}),
      source: request.source,
      consentedAt: new Date().toISOString(),
    };
  }

  async withdraw(input: {
    userId: UUIDv7;
    receiptId: UUIDv7;
    reason?: string;
    correlationId: string;
  }): Promise<void> {
    const { userId, receiptId, reason, correlationId } = input;

    const receipt = await this.receipts.findById({ userId, receiptId });
    if (!receipt) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Consent receipt not found.", { correlationId });
    }

    const existing = await this.withdrawals.findByReceiptId(receiptId);
    if (existing) {
      throw new SomnusError(ErrorCode.CONFLICT, "This consent has already been withdrawn.", {
        correlationId,
      });
    }

    await this.withdrawals.create({ receiptId, userId, ...(reason ? { reason } : {}) });

    await this.audit.recordEvent({
      eventType: "consent.receipt.withdrawn",
      userId,
      purposeKey: receipt.purposeKey,
    });

    await this.eventPublisher.publish(
      makeEvent({
        eventType: "consent.receipt.withdrawn.v1",
        producer: "somnus-identity-service",
        correlationId,
        subject: { type: "user", id: userId },
        data: { receiptId, purposeKey: receipt.purposeKey },
      }),
    );
  }

  /**
   * The sole cross-module entry point (build plan ADR 0010):
   * `AuthorizationService` calls this directly (in-process), and
   * `POST /internal/v1/consents/check` calls it too, for any other
   * caller. Reads straight through to the repositories -- see this
   * class's header comment on why there is no caching to invalidate.
   */
  async check(request: ConsentCheckRequest): Promise<ConsentCheckResponse> {
    const receipt = await this.receipts.findLatestForPurpose({
      userId: request.userId,
      purposeKey: request.purposeKey,
    });
    if (!receipt) {
      return { consented: false, withdrawn: false };
    }
    const withdrawal = await this.withdrawals.findByReceiptId(receipt.id);
    const withdrawn = withdrawal !== null;
    return { consented: !withdrawn, withdrawn };
  }

  /**
   * Account erasure (build plan §21 / Checkpoint 13.2, right to erasure). Deletes
   * the user's consent receipts and withdrawals. Part of the module's public
   * interface — identity reaches the isolated consent database only through here
   * (ADR 0010). The consent audit trail is retained (§21).
   */
  async eraseUser(userId: UUIDv7): Promise<void> {
    await this.withdrawals.deleteByUserId(userId);
    await this.receipts.deleteByUserId(userId);
  }
}
