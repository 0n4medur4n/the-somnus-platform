import { Body, Controller, Get, HttpCode, Module, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  PlatformInvitationAcceptInternalRequestSchema,
  PlatformInvitationCreateRequestSchema,
  PlatformInvitationIdentitySchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ConsentModule } from "../consent/consent.module.js";
import { PlatformInvitationsService } from "./platform-invitations.service.js";

class CreateDto extends createZodDto(PlatformInvitationCreateRequestSchema) {}
class LookupDto extends createZodDto(PlatformInvitationIdentitySchema) {}
class AcceptDto extends createZodDto(PlatformInvitationAcceptInternalRequestSchema) {}

@ApiTags("platform-invitations")
@Controller("internal/v1/admin/platform-invitations")
class AdminPlatformInvitationsController {
  constructor(private readonly invitations: PlatformInvitationsService) {}
  @Get() list(@CurrentActorId() actorId: string) {
    return this.invitations.list(actorId);
  }
  @Post() create(@CurrentActorId() actorId: string, @Body() body: CreateDto) {
    return this.invitations.create(actorId, body);
  }
  @Post(":invitationId/revoke")
  @HttpCode(204)
  revoke(@CurrentActorId() actorId: string, @Param("invitationId") id: string) {
    return this.invitations.revoke(actorId, id);
  }
}

@ApiTags("platform-invitations")
@Controller("internal/v1/platform-invitations")
class PlatformInvitationsController {
  constructor(private readonly invitations: PlatformInvitationsService) {}
  @Post("lookup")
  @HttpCode(200)
  lookup(@Body() body: LookupDto) {
    return this.invitations.lookup(body.invitationId, body.email);
  }
  @Post("accept")
  @HttpCode(200)
  accept(@Body() body: AcceptDto) {
    return this.invitations.accept(body, "platform-invitation-accept");
  }
}

@Module({
  imports: [ConsentModule, AuthorizationModule],
  providers: [PlatformInvitationsService],
  controllers: [AdminPlatformInvitationsController, PlatformInvitationsController],
})
export class PlatformInvitationsModule {}
