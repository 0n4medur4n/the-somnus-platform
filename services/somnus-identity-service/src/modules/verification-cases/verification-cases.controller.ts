import { Controller, Get, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { VerificationCase } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
import { VerificationCasesService } from "./verification-cases.service.js";

@ApiTags("verification-cases")
@Controller({ path: "v1/me/professional/verification-cases" })
export class VerificationCasesController {
  constructor(private readonly verificationCasesService: VerificationCasesService) {}

  @Post()
  @ApiOperation({ summary: "Open a verification case for the actor's own professional profile." })
  async open(@CurrentActorId() actorId: string): Promise<VerificationCase> {
    return this.verificationCasesService.openForActor(actorId);
  }

  @Get()
  @ApiOperation({ summary: "List the actor's own verification cases." })
  async list(@CurrentActorId() actorId: string): Promise<VerificationCase[]> {
    return this.verificationCasesService.listForActor(actorId);
  }
}
