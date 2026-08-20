import type { NotificationTask } from "@somnus/api-contracts";
import type { DeliveryStore } from "./db/repositories/index.js";
import type { EmailProvider } from "./delivery/brevo.client.js";
import { renderEmail } from "./templates/render.js";

/** Total delivery attempts before a task is parked in the dead-letter state. */
export const MAX_ATTEMPTS = 5;

export type ProcessOutcome = "sent" | "skipped" | "dead_letter";

export type ProcessResult = {
  outcome: ProcessOutcome;
  deliveryId: string;
};

/**
 * A transient failure: the caller should return a retryable status so Cloud Tasks
 * redelivers the same task (same idempotency key) for another attempt.
 */
export class NotificationTransientError extends Error {}

/**
 * The Notification module's public interface (build plan ADR 0010): the ONLY way
 * anything reaches the module. Consumes a validated task, dedupes it by
 * idempotency key, renders a localized email, delivers it via the provider, and
 * records the delivery status. Never assembles or forwards health details (§3.7).
 */
export class NotificationService {
  constructor(
    private readonly deliveries: DeliveryStore,
    private readonly provider: EmailProvider,
  ) {}

  async process(task: NotificationTask): Promise<ProcessResult> {
    const existing = await this.deliveries.findByIdempotencyKey(task.idempotencyKey);

    // Idempotency: a task already delivered is never sent twice.
    if (existing?.status === "sent") {
      return { outcome: "skipped", deliveryId: existing.id };
    }

    const id =
      existing?.id ??
      (await this.deliveries.create({
        idempotencyKey: task.idempotencyKey,
        type: task.type,
        recipient: task.to,
        locale: task.locale,
      }));

    const message = renderEmail(task.type, task.locale, task.link, task.params);

    try {
      const providerMessageId = await this.provider.send(task.to, message);
      await this.deliveries.markSent(id, providerMessageId);
      return { outcome: "sent", deliveryId: id };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const attemptsSoFar = existing?.attempts ?? 0;

      // Max attempts exhausted (this attempt included): stop retrying.
      if (attemptsSoFar + 1 >= MAX_ATTEMPTS) {
        await this.deliveries.markDeadLetter(id, reason);
        return { outcome: "dead_letter", deliveryId: id };
      }

      await this.deliveries.markFailed(id, reason);
      throw new NotificationTransientError(reason);
    }
  }
}
