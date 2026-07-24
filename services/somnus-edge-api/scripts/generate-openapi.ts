/**
 * Generate the OpenAPI document for somnus-edge-api and write it to
 * schemas/openapi/edge-api.json.
 *
 * Per build plan §3.4, OpenAPI is generated from Zod schemas, never
 * hand-written. This script bootstraps the Nest app in-process, runs
 * SwaggerModule.createDocument, and dumps the JSON.
 *
 * Usage:
 *   pnpm --filter @somnus/edge-api generate:openapi
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "../src/app.module.js";

const OUT_PATH = resolve(process.cwd(), "..", "..", "schemas", "openapi", "edge-api.json");

async function main(): Promise<void> {
  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create(AppModule, adapter, { logger: false });
  await app.init();

  const config = new DocumentBuilder()
    .setTitle("The Somnus — Edge API")
    .setDescription("Public BFF: Firebase token verification, sessions, CSRF, CORS, composition.")
    .setVersion(process.env["SERVICE_VERSION"] ?? "0.0.0")
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  await app.close();

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`OpenAPI written to ${join("schemas", "openapi", "edge-api.json")}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `OpenAPI generation failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
