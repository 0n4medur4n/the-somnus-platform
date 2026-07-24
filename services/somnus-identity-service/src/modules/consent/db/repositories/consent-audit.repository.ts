import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { ConsentDb } from "../consent-db.client.js";
import { consentAuditEvents } from "../schema/index.js";
import type { ConsentPurposeKeyRow } from "./consent-purposes.repository.js";

export type NewConsentAuditEvent = {
  eventType: string;
  userId?: UUIDv7;
  purposeKey?: ConsentPurposeKeyRow;
  /** Never passwords, tokens, cookies, or health data (build plan §19/§21). */
  data?: Record<string, unknown>;
};

/** Append-only audit trail for consent actions, separate from identity's `identity_audit_events`. */
export class ConsentAuditRepository {
  constructor(private readonly db: ConsentDb) {}

  async recordEvent(input: NewConsentAuditEvent): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(consentAuditEvents).values({ id, ...input });
    return id;
  }

  async listEventsForUser(userId: UUIDv7) {
    return this.db.select().from(consentAuditEvents).where(eq(consentAuditEvents.userId, userId));
  }
}
