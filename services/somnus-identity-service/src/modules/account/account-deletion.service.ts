import { Injectable } from "@nestjs/common";
import type { UUIDv7 } from "@somnus/api-contracts";
import {
  AccountDeletionRepository,
  AuditRepository,
} from "../../infrastructure/db/repositories/index.js";
import { ConsentService } from "../consent/consent.service.js";

/**
 * Right-to-erasure orchestration within identity (build plan §21 / Checkpoint
 * 13.2). Records the erasure to the retained audit trail, erases the user's
 * consent (isolated module, its own database), then erases their identity data.
 * `identity_audit_events` and shared organizations are retained. Cross-service
 * data (the user's claimed assessments in Morpheo) is erased by the edge, which
 * orchestrates the full account deletion.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly accountDeletion: AccountDeletionRepository,
    private readonly consent: ConsentService,
    private readonly audit: AuditRepository,
  ) {}

  async eraseAccount(userId: UUIDv7): Promise<void> {
    // Record first: the audit trail keeps proof of the erasure even if a later
    // step fails, and references the user while it still exists.
    await this.audit.recordEvent({
      eventType: "identity.account.erased",
      actorUserId: userId,
      subjectUserId: userId,
    });
    await this.consent.eraseUser(userId);
    await this.accountDeletion.eraseIdentityData(userId);
  }
}
