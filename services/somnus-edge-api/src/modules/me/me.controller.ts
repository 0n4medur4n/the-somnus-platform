import { Body, Controller, Get, HttpCode, Patch, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { MeResponse } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { ProfilePatchDto } from "./me.dto.js";
import { MeService } from "./me.service.js";

/**
 * Session-guarded composition of the current actor's identity record.
 * `PATCH /v1/me/profile` is additionally CSRF-protected by the global
 * preHandler (see bootstrap/harden.ts) as a state-changing route.
 */
@ApiTags("me")
@Controller({ path: "v1/me" })
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({
    summary: "The current actor's user record and profile(s), composed from identity.",
  })
  async getMe(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<MeResponse> {
    return this.me.getMe(session, correlationId);
  }

  @Patch("profile")
  @HttpCode(204)
  @ApiOperation({ summary: "Patch the current actor's individual profile via identity." })
  async patchProfile(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: ProfilePatchDto,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.me.patchProfile(session, body, correlationId);
  }
}
