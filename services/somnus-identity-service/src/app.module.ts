import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { createLogger, type Logger } from "@somnus/observability";
import { ZodValidationPipe as NestjsZodValidationPipe } from "nestjs-zod";
import { SomnusExceptionFilter } from "./common/filters/somnus-exception.filter.js";
import {
  CORRELATION_LOGGER,
  CorrelationInterceptor,
} from "./common/interceptors/correlation.interceptor.js";
import { DbModule } from "./infrastructure/db/db.module.js";
import { AccessGrantsModule } from "./modules/access-grants/access-grants.module.js";
import { AuthorizationModule } from "./modules/authorization/authorization.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { InvitationsModule } from "./modules/invitations/invitations.module.js";
import { MeModule } from "./modules/me/me.module.js";
import { MembershipsModule } from "./modules/memberships/memberships.module.js";
import { OrganizationsModule } from "./modules/organizations/organizations.module.js";
import { VerificationCasesModule } from "./modules/verification-cases/verification-cases.module.js";
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
  imports: [
    DbModule,
    HealthModule,
    VersionModule,
    AuthorizationModule,
    MeModule,
    OrganizationsModule,
    MembershipsModule,
    InvitationsModule,
    VerificationCasesModule,
    AccessGrantsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: SomnusExceptionFilter },
    { provide: CORRELATION_LOGGER, useValue: ROOT_LOGGER },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    // Global: nestjs-zod's pipe validates any @Body()/@Param()/@Query()
    // whose declared type is a `createZodDto` class (see
    // common/dto/identity.dto.ts) and passes through everything else
    // untouched -- e.g. the plain `string` from @CurrentActorId().
    // Build plan §3.4: Zod is the single source of truth for contracts.
    { provide: APP_PIPE, useClass: NestjsZodValidationPipe },
  ],
})
export class AppModule {}
