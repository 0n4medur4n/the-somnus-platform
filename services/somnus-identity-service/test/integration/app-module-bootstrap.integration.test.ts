import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, it } from "vitest";
import { AppModule } from "../../src/app.module.js";

/**
 * The other e2e tests (test/*.e2e.test.ts) boot a minimal hand-built
 * TestAppModule to avoid framework overhead -- none of them actually
 * exercise the real AppModule's DI graph (DbModule + every feature
 * module wired together). A missing export, an un-imported module, or
 * a circular dependency would only surface at real boot time; this is
 * that check.
 */
describe("AppModule bootstrap", () => {
  it("compiles the full dependency graph with no missing providers", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.close();
  });
});
