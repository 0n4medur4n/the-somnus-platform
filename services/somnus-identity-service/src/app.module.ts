import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { createLogger, type Logger } from "@somnus/observability";
import { SomnusExceptionFilter } from "./common/filters/somnus-exception.filter.js";
import {
  CORRELATION_LOGGER,
  CorrelationInterceptor,
} from "./common/interceptors/correlation.interceptor.js";
import { HealthModule } from "./modules/health/health.module.js";
import { VersionModule } from "./modules/version/version.module.js";

export const ROOT_LOGGER: Logger = createLogger({
  service: {
    name: "somnus-identity-service",
    env: process.env["NODE_ENV"] ?? "development",
    version: process.env["SERVICE_VERSION"] ?? "0.0.0",
    commit: process.env["SERVICE_COMMIT"] ?? "local",
  },
  correlationId: "bootstrap",
  level: (process.env["LOG_LEVEL"] as "debug" | "info" | "warn" | "error" | undefined) ?? "info",
});

@Module({
  imports: [HealthModule, VersionModule],
  providers: [
    // APP_PIPE: the ZodValidationPipe is not a globally-instantiated pipe
    // because it needs a ZodType per @UsePipes. Handlers that need Zod
    // validation attach a ZodValidationPipe explicitly.
    { provide: APP_FILTER, useClass: SomnusExceptionFilter },
    { provide: CORRELATION_LOGGER, useValue: ROOT_LOGGER },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
  ],
})
export class AppModule {}
