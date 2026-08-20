import type { NotificationType, SupportedLocale } from "@somnus/api-contracts";
import { UUIDv7 } from "@somnus/api-contracts";
import { eq, sql } from "drizzle-orm";
import type { NotificationDb } from "../notification-db.client.js";
import { notificationDeliveries } from "../schema/index.js";

const MAX_ERROR_LEN = 500;

export type NewDelivery = {
  idempotencyKey: string;
  type: NotificationType;
  recipient: string;
  locale: SupportedLocale;
};

export type DeliveryRow = typeof notificationDeliveries.$inferSelect;

/**
 * The persistence surface NotificationService depends on — an interface so the
 * service is unit-tested with a fake, no database. DeliveriesRepository satisfies
 * it structurally.
 */
export interface DeliveryStore {
  create(input: NewDelivery): Promise<string>;
  findByIdempotencyKey(idempotencyKey: string): Promise<DeliveryRow | null>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markDeadLetter(id: string, error: string): Promise<void>;
}

export class DeliveriesRepository implements DeliveryStore {
  constructor(private readonly db: NotificationDb) {}

  /** Insert a new delivery row (id is a sortable UUIDv7). */
  async create(input: NewDelivery): Promise<string> {
    const id = UUIDv7();
    await this.db.insert(notificationDeliveries).values({ id, ...input });
    return id;
  }

  /** The idempotency guard: returns an existing row for this key, or null. */
  async findByIdempotencyKey(idempotencyKey: string) {
    const rows = await this.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({ status: "sent", providerMessageId, lastError: null })
      .where(eq(notificationDeliveries.id, id));
  }

  /** Record a failed attempt (increments the attempt count). */
  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({
        status: "failed",
        lastError: error.slice(0, MAX_ERROR_LEN),
        attempts: sql`${notificationDeliveries.attempts} + 1`,
      })
      .where(eq(notificationDeliveries.id, id));
  }

  /** Max attempts exhausted: park it in the dead-letter state. */
  async markDeadLetter(id: string, error: string): Promise<void> {
    await this.db
      .update(notificationDeliveries)
      .set({ status: "dead_letter", lastError: error.slice(0, MAX_ERROR_LEN) })
      .where(eq(notificationDeliveries.id, id));
  }
}
