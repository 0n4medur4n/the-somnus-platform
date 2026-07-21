/**
 * Generate the OpenAPI document for somnus-identity-service and write
 * it to schemas/openapi/identity-service.json.
 *
 * Per build plan §3.4, OpenAPI is generated from Zod schemas, never
 * hand-written. This script bootstraps the Nest app in-process, runs
 * SwaggerModule.createDocument, and dumps the JSON.
 *
 * Usage:
 *   pnpm --filter @somnus/identity-service generate:openapi
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module.js";

const OUT_PATH = resolve(process.cwd(), "..", "..", "schemas", "openapi", "identity-service.json");

async function main(): Promise<void> {
  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create(AppModule, adapter, { logger: false });
  await app.init();

  const config = new DocumentBuilder()
    .setTitle("The Somnus — Identity Service")
    .setDescription(
      "Platform users, organizations, memberships, invitations, consent, authorization.",
    )
    .setVersion(process.env["SERVICE_VERSION"] ?? "0.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  await app.close();

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(
    `OpenAPI written to ${join("schemas", "openapi", "identity-service.json")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `OpenAPI generation failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
