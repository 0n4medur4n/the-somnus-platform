import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";

describe("worker shell (e2e)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves liveness and echoes a valid correlation id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-correlation-id": "abc-123" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-correlation-id"]).toBe("abc-123");
  });

  it("generates a correlation id when the header is missing", async () => {
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    expect(response.json().service).toBe("somnus-worker");
    expect(response.headers["x-correlation-id"]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("maps an unknown route to the §16 NOT_FOUND error shape", async () => {
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});
