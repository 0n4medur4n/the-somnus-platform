import { UUIDv7 } from "@somnus/api-contracts";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import {
  accountStatusHistory,
  deletionRequests,
  identityAuditEvents,
  sessionRevocations,
} from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

export type NewAuditEvent = {
  eventType: string;
  actorUserId?: UUIDv7;
  subjectUserId?: UUIDv7;
  organizationId?: UUIDv7;
  /** Never passwords, tokens, cookies, or health data (build plan §19/§21). */
  data?: Record<string, unknown>;
};

export type NewStatusChange = UserScope & {
  previousStatus: string;
  newStatus: string;
  reason?: string;
  changedBy?: UUIDv7;
};

/** Append-only audit trail. Reads that list a user's own history are UserScope; writes create new rows. */
export class AuditRepository {
  constructor(private readonly db: Db) {}

  async recordEvent(input: NewAuditEvent): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(identityAuditEvents).values({ id, ...input });
    return id;
  }

  async listEventsForSubject(scope: UserScope) {
    return this.db
      .select()
      .from(identityAuditEvents)
      .where(eq(identityAuditEvents.subjectUserId, scope.userId))
      .orderBy(desc(identityAuditEvents.occurredAt));
  }

  async recordStatusChange(input: NewStatusChange): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(accountStatusHistory).values({
      id,
      userId: input.userId,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      reason: input.reason,
      changedBy: input.changedBy,
    });
    return id;
  }

  async listStatusHistory(scope: UserScope) {
    return this.db
      .select()
      .from(accountStatusHistory)
      .where(eq(accountStatusHistory.userId, scope.userId))
      .orderBy(desc(accountStatusHistory.changedAt));
  }

  async recordSessionRevocation(scope: UserScope & { reason?: string }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db
      .insert(sessionRevocations)
      .values({ id, userId: scope.userId, reason: scope.reason });
    return id;
  }

  async listSessionRevocations(scope: UserScope) {
    return this.db
      .select()
      .from(sessionRevocations)
      .where(eq(sessionRevocations.userId, scope.userId));
  }

  async requestDeletion(scope: UserScope): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(deletionRequests).values({ id, userId: scope.userId });
    return id;
  }

  async findPendingDeletionRequest(scope: UserScope) {
    const rows = await this.db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.userId, scope.userId))
      .orderBy(desc(deletionRequests.requestedAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
