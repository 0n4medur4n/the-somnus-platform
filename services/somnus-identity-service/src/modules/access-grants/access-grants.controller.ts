import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AccessGrant } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
// biome-ignore lint/style/useImportType: used as a @Body() parameter type -- nestjs-zod's global ZodValidationPipe needs a real import to recognize and validate this DTO class at runtime.
import { AccessGrantCreateDto } from "../../common/dto/identity.dto.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
import { AccessGrantsService } from "./access-grants.service.js";

@ApiTags("access-grants")
@Controller({ path: "v1/me/access-grants" })
export class AccessGrantsController {
  constructor(private readonly accessGrantsService: AccessGrantsService) {}

  @Post()
  @ApiOperation({
    summary: "Grant a professional access to the actor's own data (build plan §11).",
  })
  async create(
    @CurrentActorId() actorId: string,
    @Body() body: AccessGrantCreateDto,
  ): Promise<AccessGrant> {
    return this.accessGrantsService.createForActor(actorId, body);
  }

  @Get()
  @ApiOperation({ summary: "List the actor's own active access grants." })
  async list(@CurrentActorId() actorId: string): Promise<AccessGrant[]> {
    return this.accessGrantsService.listForActor(actorId);
  }

  @Post(":grantId/revoke")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke a grant the actor previously issued." })
  async revoke(
    @CurrentActorId() actorId: string,
    @Param("grantId") grantId: string,
  ): Promise<void> {
    await this.accessGrantsService.revokeForActor(actorId, grantId);
  }
}
