import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { applyHardening } from "../../src/bootstrap/harden.js";
import { loadEdgeConfig } from "../../src/config/edge-config.js";
import { WORKER_CLIENT } from "../../src/infrastructure/internal-clients/internal-clients.module.js";
import { makeFakeIdentityClient, type RecordedRequest } from "../support/fake-identity.js";

/**
 * The sign-in link by email, against the real Firebase Auth emulator (the link
 * and its code are Firebase's) and the real hardened app (CSRF, rate limits).
 * The worker is faked: what matters here is the task edge-api hands it.
 */
describe("POST /v1/auth/email-link (sign-in link sent from our own domain)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let workerRequests: RecordedRequest[];
  let workerStatus = 200;
  let ip = 0;
  const callback = loadEdgeConfig(process.env).SIGN_IN_CALLBACK_URL;

  beforeAll(async () => {
    const worker = makeFakeIdentityClient(() => ({
      status: workerStatus,
      body: { outcome: "sent" },
    }));
    workerRequests = worker.requests;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKER_CLIENT)
      .useValue(worker.client)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
    );
    await applyHardening(app, loadEdgeConfig(process.env));
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    workerRequests.length = 0;
    workerStatus = 200;
    ip += 1;
  });

  const request = (payload: unknown, from = `203.0.113.${ip}`) =>
    server.inject({
      method: "POST",
      url: "/v1/auth/email-link",
      headers: { "content-type": "application/json", "x-forwarded-for": from },
      payload: JSON.stringify(payload),
    });

  const unique = () => `link-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  it("hands the worker a clean link to our callback, with the one-time code and nothing else", async () => {
    const email = unique();
    const res = await request({ email, locale: "ca" });
    expect(res.statusCode).toBe(204);
    expect(res.headers["cache-control"]).toBe("no-store");

    expect(workerRequests).toHaveLength(1);
    expect(workerRequests[0]?.path).toBe("/internal/v1/notifications/tasks");
    const task = JSON.parse(workerRequests[0]?.body ?? "{}") as {
      type: string;
      to: string;
      locale: string;
      link: string;
      idempotencyKey: string;
    };
    expect(task).toMatchObject({ type: "sign_in_link", to: email, locale: "ca" });
    const link = new URL(task.link);
    expect(`${link.origin}${link.pathname}`).toBe(callback);
    expect([...link.searchParams.keys()].sort()).toEqual(["lng", "mode", "oobCode"]);
    expect(link.searchParams.get("mode")).toBe("signIn");
    expect(link.searchParams.get("oobCode")?.length).toBeGreaterThan(10);
    expect(task.link).not.toContain("apiKey");
  });

  it("sends at most one link a minute to the same address, answering the same either way", async () => {
    const email = unique();
    expect((await request({ email, locale: "es" }, "198.51.100.1")).statusCode).toBe(204);
    expect((await request({ email, locale: "es" }, "198.51.100.2")).statusCode).toBe(204);
    expect(workerRequests).toHaveLength(1);
  });

  it("sends a console sign-in to the console's callback", async () => {
    const res = await request({ email: unique(), locale: "en", client: "console" });
    expect(res.statusCode).toBe(204);
    const task = JSON.parse(workerRequests[0]?.body ?? "{}") as { link: string };
    const link = new URL(task.link);
    expect(`${link.origin}${link.pathname}`).toBe(
      loadEdgeConfig(process.env).SIGN_IN_CONSOLE_CALLBACK_URL,
    );
  });

  it("needs no session and no CSRF token: it happens before sign-in", async () => {
    const res = await request({ email: unique(), locale: "es" });
    expect(res.statusCode).toBe(204);
  });

  it("rejects anything but an address and a locale", async () => {
    expect((await request({ email: "nope", locale: "es" })).statusCode).toBe(400);
    expect(
      (await request({ email: unique(), locale: "es", continueUrl: "https://evil.example" }))
        .statusCode,
    ).toBe(400);
    expect(workerRequests).toHaveLength(0);
  });

  it("limits each IP to five requests in ten minutes", async () => {
    const from = "192.0.2.77";
    for (let i = 0; i < 5; i += 1) {
      expect((await request({ email: unique(), locale: "es" }, from)).statusCode).toBe(204);
    }
    expect((await request({ email: unique(), locale: "es" }, from)).statusCode).toBe(429);
  });

  it("reports a delivery failure instead of pretending the email went out", async () => {
    workerStatus = 503;
    const res = await request({ email: unique(), locale: "es" });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });
});
