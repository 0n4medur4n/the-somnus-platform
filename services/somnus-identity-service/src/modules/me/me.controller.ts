import { Body, Controller, Get, HttpCode, Patch } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { MeResponse } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import { ProfilePatchDto } from "../../common/dto/identity.dto.js";
import { MeService } from "./me.service.js";

@ApiTags("me")
@Controller({ path: "v1/me" })
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  @ApiOperation({ summary: "The current actor's user record and profile(s)." })
  async getMe(@CurrentActorId() actorId: string): Promise<MeResponse> {
    return this.meService.getMe(actorId);
  }

  @Patch("profile")
  @HttpCode(204)
  @ApiOperation({ summary: "Patch the current actor's individual profile." })
  async patchProfile(
    @CurrentActorId() actorId: string,
    @Body() body: ProfilePatchDto,
  ): Promise<void> {
    await this.meService.patchProfile(actorId, body);
  }
}
