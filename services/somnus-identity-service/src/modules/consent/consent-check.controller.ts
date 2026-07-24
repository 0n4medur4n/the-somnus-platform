import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ConsentCheckResponse } from "@somnus/api-contracts";
// biome-ignore lint/style/useImportType: used as a @Body() parameter type -- nestjs-zod's global ZodValidationPipe needs a real import to recognize and validate this DTO class at runtime.
import { ConsentCheckDto } from "./consent.dto.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
import { ConsentService } from "./consent.service.js";

/**
 * Internal-only (build plan §16: `/internal/v1/` prefix, never exposed
 * through edge-api's public routes). `AuthorizationService` calls
 * `ConsentService.check()` directly, in-process -- this HTTP endpoint
 * exists for the same reason authorization's does: any other future
 * caller that isn't already inside this service.
 */
@ApiTags("consent")
@Controller({ path: "internal/v1/consents" })
export class ConsentCheckController {
  constructor(private readonly consentService: ConsentService) {}

  @Post("check")
  @HttpCode(200)
  @ApiOperation({ summary: "Check whether a user has withdrawn consent for a purpose." })
  async check(@Body() body: ConsentCheckDto): Promise<ConsentCheckResponse> {
    return this.consentService.check(body);
  }
}
