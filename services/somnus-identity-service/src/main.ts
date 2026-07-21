import "reflect-metadata";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@somnus/config";
import { createLogger } from "@somnus/observability";
import { AppModule } from "./app.module.js";
import { SomnusLogger } from "./infrastructure/logger/somnus.logger.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig({ serviceName: "somnus-identity-service" });
  const logger = createLogger({ service: config.service, correlationId: "bootstrap" });
  SomnusLogger.replaceGlobalLogger(logger);

  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    abortOnError: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("The Somnus — Identity Service")
    .setDescription(
      "Platform users, organizations, memberships, invitations, consent, authorization.",
    )
    .setVersion("0.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("/docs", app, document);

  const port = (config.private["PORT"] as number | undefined) ?? 8080;
  const host = "0.0.0.0";
  await app.listen(port, host);
  logger.info("identity-service listening", { port, host });
}

bootstrap().catch((err) => {
  console.error("[bootstrap] fatal", err);
  process.exit(1);
});
