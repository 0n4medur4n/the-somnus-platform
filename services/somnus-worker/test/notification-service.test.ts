import type { NotificationTask } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DeliveryRow,
  DeliveryStore,
  NewDelivery,
} from "../src/modules/notification/db/repositories/index.js";
import {
  MAX_ATTEMPTS,
  NotificationService,
  NotificationTransientError,
} from "../src/modules/notification/notification.service.js";
import type { EmailMessage } from "../src/modules/notification/templates/render.js";

function makeRow(over: Partial<DeliveryRow>): DeliveryRow {
  return {
    id: "d1",
    idempotencyKey: "k",
    type: "invitation",
    recipient: "x@example.com",
    locale: "es",
    status: "pending",
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

class FakeStore implements DeliveryStore {
  rows = new Map<string, DeliveryRow>();
  created: NewDelivery[] = [];
  sent: Array<{ id: string; messageId: string }> = [];
  failed: Array<{ id: string; error: string }> = [];
  dead: Array<{ id: string; error: string }> = [];

  async create(input: NewDelivery): Promise<string> {
    const id = `d-${input.idempotencyKey}`;
    this.created.push(input);
    this.rows.set(input.idempotencyKey, makeRow({ id, ...input }));
    return id;
  }
  async findByIdempotencyKey(key: string): Promise<DeliveryRow | null> {
    return this.rows.get(key) ?? null;
  }
  async markSent(id: string, messageId: string): Promise<void> {
    this.sent.push({ id, messageId });
  }
  async markFailed(id: string, error: string): Promise<void> {
    this.failed.push({ id, error });
  }
  async markDeadLetter(id: string, error: string): Promise<void> {
    this.dead.push({ id, error });
  }
}

class FakeProvider {
  sent: Array<{ to: string; message: EmailMessage }> = [];
  constructor(
    private readonly behavior: "ok" | "throw" = "ok",
    private readonly messageId = "brevo-1",
  ) {}
  async send(to: string, message: EmailMessage): Promise<string> {
    this.sent.push({ to, message });
    if (this.behavior === "throw") throw new Error("brevo 500");
    return this.messageId;
  }
}

function task(over: Partial<NotificationTask> = {}): NotificationTask {
  return {
    idempotencyKey: "invite:1",
    type: "invitation",
    to: "person@example.com",
    locale: "es",
    link: "https://app.somnus.example/invitations/accept?token=abc",
    params: { organizationName: "Acme" },
    ...over,
  };
}

describe("NotificationService", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
  });

  it("delivers a fresh task and records it sent", async () => {
    const provider = new FakeProvider("ok", "brevo-xyz");
    const result = await new NotificationService(store, provider).process(task());

    expect(result.outcome).toBe("sent");
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe("person@example.com");
    expect(store.sent).toEqual([{ id: "d-invite:1", messageId: "brevo-xyz" }]);
  });

  it("is idempotent: a task already sent is skipped, never re-delivered", async () => {
    store.rows.set("invite:1", makeRow({ id: "d1", status: "sent" }));
    const provider = new FakeProvider("ok");

    const result = await new NotificationService(store, provider).process(task());

    expect(result.outcome).toBe("skipped");
    expect(provider.sent).toHaveLength(0);
  });

  it("selects the locale: an en task delivers the English copy", async () => {
    const provider = new FakeProvider("ok");
    await new NotificationService(store, provider).process(task({ locale: "en" }));

    expect(provider.sent[0]?.message.subject).toBe("You've been invited to The Somnus");
  });

  it("delivers a report_ready task as well (exit criterion: both flows)", async () => {
    const provider = new FakeProvider("ok");
    const result = await new NotificationService(store, provider).process(
      task({ type: "report_ready", idempotencyKey: "report:1", params: {} }),
    );

    expect(result.outcome).toBe("sent");
    expect(provider.sent[0]?.message.subject).toBe("Tu informe está listo");
  });

  it("on a transient failure records a failed attempt and asks for retry", async () => {
    const provider = new FakeProvider("throw");
    const service = new NotificationService(store, provider);

    await expect(service.process(task())).rejects.toBeInstanceOf(NotificationTransientError);
    expect(store.failed).toHaveLength(1);
    expect(store.dead).toHaveLength(0);
  });

  it("dead-letters once the max attempts are exhausted (no more retries)", async () => {
    // A prior row already at MAX_ATTEMPTS-1 failures: this attempt is the last.
    store.rows.set("invite:1", makeRow({ id: "d1", status: "failed", attempts: MAX_ATTEMPTS - 1 }));
    const provider = new FakeProvider("throw");

    const result = await new NotificationService(store, provider).process(task());

    expect(result.outcome).toBe("dead_letter");
    expect(store.dead).toHaveLength(1);
    expect(store.failed).toHaveLength(0);
  });
});
