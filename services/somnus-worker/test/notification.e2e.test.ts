import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type {
  DeliveryRow,
  DeliveryStore,
  NewDelivery,
} from "../src/modules/notification/db/repositories/index.js";
import { DeliveriesRepository } from "../src/modules/notification/db/repositories/index.js";
import { EMAIL_PROVIDER } from "../src/modules/notification/notification.module.js";
import type { EmailMessage } from "../src/modules/notification/templates/render.js";

class FakeStore implements DeliveryStore {
  async create(_input: NewDelivery): Promise<string> {
    return "d-1";
  }
  async findByIdempotencyKey(_key: string): Promise<DeliveryRow | null> {
    return null;
  }
  async markSent(): Promise<void> {}
  async markFailed(): Promise<void> {}
  async markDeadLetter(): Promise<void> {}
}

class FakeProvider {
  constructor(private readonly behavior: "ok" | "throw") {}
  async send(_to: string, _message: EmailMessage): Promise<string> {
    if (this.behavior === "throw") throw new Error("brevo 500");
    return "brevo-1";
  }
}

const TASK = {
  idempotencyKey: "invite:e2e",
  type: "invitation",
  to: "person@example.com",
  locale: "es",
  link: "https://app.somnus.example/invitations/accept?token=abc",
  params: { organizationName: "Acme" },
};

async function bootWith(behavior: "ok" | "throw"): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DeliveriesRepository)
    .useValue(new FakeStore())
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(new FakeProvider(behavior))
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("notification consumer (e2e)", () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app.close();
  });

  it("acks a delivered task (2xx, outcome sent)", async () => {
    app = await bootWith("ok");
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/notifications/tasks",
      payload: TASK,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ outcome: "sent" });
  });

  it("returns 503 on a transient failure so Cloud Tasks retries", async () => {
    app = await bootWith("throw");
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/notifications/tasks",
      payload: TASK,
    });
    expect(response.statusCode).toBe(503);
  });

  it("rejects a task with a bad email (400 VALIDATION_FAILED)", async () => {
    app = await bootWith("ok");
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/notifications/tasks",
      payload: { ...TASK, to: "not-an-email" },
    });
    expect(response.statusCode).toBe(400);
  });
});
