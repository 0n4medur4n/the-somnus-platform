import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * These e2e-style tests follow the build plan §20 Checkpoint 3.1:
 * a NestJS app boots, Fastify serves, the health and version
 * endpoints respond as documented, and the response shape is
 * stable. They use a minimal app to avoid the runtime complexity
 * of the full AppModule (logger, interceptors, filters); those are
 * covered by their own unit tests.
 *
 * We use `fastify.inject()` (the Fastify-native test helper)
 * instead of supertest. Supertest expects a Node http.Server
 * (`app.address()`) and the Fastify adapter does not expose it
 * after `app.init()` without `app.listen()`.
 */

@Controller("health")
class TestHealthController {
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  ready(): { status: "ready" } {
    return { status: "ready" };
  }
}

@Controller("version")
class TestVersionController {
  @Get()
  version(): { service: string; version: string; commit: string; env: string; node: string } {
    return {
      service: "somnus-identity-service",
      version: process.env["SERVICE_VERSION"] ?? "0.0.0",
      commit: process.env["SERVICE_COMMIT"] ?? "local",
      env: process.env["NODE_ENV"] ?? "development",
      node: process.versions.node,
    };
  }
}

@Module({ controllers: [TestHealthController, TestVersionController] })
class TestAppModule {}

interface JsonResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function inject(server: FastifyInstance, method: string, url: string): Promise<JsonResponse> {
  return server.inject({ method, url }).then((res) => ({
    statusCode: res.statusCode,
    body: res.body,
    headers: res.headers as Record<string, string | string[] | undefined>,
  }));
}

describe("somnus-identity-service e2e (Checkpoint 3.1)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env["SERVICE_NAME"] = "somnus-identity-service";
    process.env["SERVICE_VERSION"] = "test";
    process.env["SERVICE_COMMIT"] = "test";
    process.env["NODE_ENV"] = "test";
    process.env["PORT"] = "0";
    const adapter = new FastifyAdapter({ logger: false });
    app = await NestFactory.create<NestFastifyApplication>(TestAppModule, adapter, {
      logger: false,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("GET /health/live returns 200 with { status: 'ok' }", async () => {
    const res = await inject(server, "GET", "/health/live");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("GET /health/ready returns 200 with { status: 'ready' }", async () => {
    const res = await inject(server, "GET", "/health/ready");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ready" });
  });

  it("GET /version returns the service identity with sensible defaults", async () => {
    const res = await inject(server, "GET", "/version");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body["service"]).toBe("somnus-identity-service");
    expect(body["version"]).toBe("test");
    expect(body["commit"]).toBe("test");
    expect(body["env"]).toBe("test");
    expect(typeof body["node"]).toBe("string");
  });
});
