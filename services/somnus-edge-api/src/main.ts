import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@somnus/config";
import { createLogger } from "@somnus/observability";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module.js";
import { applyHardening } from "./bootstrap/harden.js";
import { loadEdgeConfig } from "./config/edge-config.js";
import { SomnusLogger } from "./infrastructure/logger/somnus.logger.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig({ serviceName: "somnus-edge-api" });
  const edgeConfig = loadEdgeConfig(process.env);
  const logger = createLogger({ service: config.service, correlationId: "bootstrap" });
  SomnusLogger.replaceGlobalLogger(logger);

  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: true,
    // Build plan §21 request-size limit. Session-exchange bodies are tiny.
    bodyLimit: edgeConfig.BODY_LIMIT_BYTES,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    abortOnError: false,
  });

  await applyHardening(app, edgeConfig);
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("The Somnus — Edge API")
    .setDescription("Public BFF: Firebase token verification, sessions, CSRF, CORS, composition.")
    .setVersion("0.0.0")
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig));
  SwaggerModule.setup("/docs", app, document);

  const port = (config.private["PORT"] as number | undefined) ?? 8080;
  const host = "0.0.0.0";
  await app.listen(port, host);
  logger.info("edge-api listening", { port, host });
}

bootstrap().catch((err) => {
  console.error("[bootstrap] fatal", err);
  process.exit(1);
});
