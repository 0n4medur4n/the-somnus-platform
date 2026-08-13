import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { createLogger, type Logger } from "@somnus/observability";
import { ZodValidationPipe as NestjsZodValidationPipe } from "nestjs-zod";
import { SomnusExceptionFilter } from "./common/filters/somnus-exception.filter.js";
import {
  CORRELATION_LOGGER,
  CorrelationInterceptor,
} from "./common/interceptors/correlation.interceptor.js";
import { FirebaseModule } from "./infrastructure/firebase/firebase.module.js";
import { InternalClientsModule } from "./infrastructure/internal-clients/internal-clients.module.js";
import { ConsentModule } from "./modules/consent/consent.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MeModule } from "./modules/me/me.module.js";
import { MorpheoModule } from "./modules/morpheo/morpheo.module.js";
import { OrganizationsModule } from "./modules/organizations/organizations.module.js";
import { RegistrationModule } from "./modules/registration/registration.module.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { VersionModule } from "./modules/version/version.module.js";

export const ROOT_LOGGER: Logger = createLogger({
  service: {
    name: "somnus-edge-api",
    env: process.env["NODE_ENV"] ?? "development",
    version: process.env["SERVICE_VERSION"] ?? "0.0.0",
    commit: process.env["SERVICE_COMMIT"] ?? "local",
  },
  correlationId: "bootstrap",
  level: (process.env["LOG_LEVEL"] as "debug" | "info" | "warn" | "error" | undefined) ?? "info",
});

@Module({
  imports: [
    FirebaseModule,
    InternalClientsModule,
    HealthModule,
    VersionModule,
    SessionsModule,
    MeModule,
    ConsentModule,
    RegistrationModule,
    OrganizationsModule,
    MorpheoModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: SomnusExceptionFilter },
    { provide: CORRELATION_LOGGER, useValue: ROOT_LOGGER },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    // Global: nestjs-zod's pipe validates any @Body()/@Param()/@Query()
    // whose declared type is a `createZodDto` class (session.dto.ts) and
    // passes everything else through untouched (build plan §3.4: Zod is
    // the single source of truth for contracts).
    { provide: APP_PIPE, useClass: NestjsZodValidationPipe },
  ],
})
export class AppModule {}
