import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AppModule } from "../../src/app.module.js";
import { applyHardening } from "../../src/bootstrap/harden.js";
import { loadEdgeConfig } from "../../src/config/edge-config.js";

export type TestApp = {
  app: NestFastifyApplication;
  server: FastifyInstance;
};

/**
 * Boots the real AppModule with the exact same hardening (helmet,
 * CORS, cookies, rate-limit, CSRF) that main.ts applies in production
 * -- a CSRF/rate-limit/cookie negative test is only meaningful if the
 * app under test is hardened identically. Overrides let a test tune
 * config (e.g. a tiny rate limit) via env before the app is built.
 */
export async function buildTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: loadEdgeConfig(process.env).BODY_LIMIT_BYTES }),
  );
  await applyHardening(app, loadEdgeConfig(process.env));
  await app.init();
  const server = app.getHttpAdapter().getInstance();
  await server.ready();
  return { app, server };
}
