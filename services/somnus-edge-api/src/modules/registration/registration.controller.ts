import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { MeResponse } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { RegistrationDto } from "./registration.dto.js";
import { RegistrationService } from "./registration.service.js";

/**
 * Session-guarded and CSRF-protected (state-changing) by the global
 * preHandler. Provisions the Somnus user for the current Firebase
 * session and returns the composed profile. Idempotent, so a 200 (not
 * 201): re-registering an existing user returns them unchanged.
 */
@ApiTags("registration")
@Controller({ path: "v1/registration" })
@UseGuards(SessionGuard)
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: "Provision the Somnus user for the current Firebase session." })
  async register(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: RegistrationDto,
    @CorrelationId() correlationId?: string,
  ): Promise<MeResponse> {
    return this.registration.register(session, body, correlationId);
  }
}
