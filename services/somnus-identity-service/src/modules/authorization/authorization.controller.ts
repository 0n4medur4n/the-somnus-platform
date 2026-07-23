import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthorizationCheckResponse } from "@somnus/api-contracts";
// biome-ignore lint/style/useImportType: used as a @Body() parameter type -- nestjs-zod's global ZodValidationPipe needs a real import to recognize and validate this DTO class at runtime.
import { AuthorizationCheckDto } from "../../common/dto/identity.dto.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";

/**
 * Internal-only (build plan §16: `/internal/v1/` prefix, never exposed
 * through edge-api's public routes). The single decision point every
 * other authorization check in the platform is meant to call, rather
 * than each service re-implementing build plan §11's rules.
 */
@ApiTags("authorization")
@Controller({ path: "internal/v1/authorization" })
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @Post("check")
  @HttpCode(200)
  @ApiOperation({ summary: "Evaluate an authorization decision (build plan §11)." })
  async check(@Body() body: AuthorizationCheckDto): Promise<AuthorizationCheckResponse> {
    return this.authorizationService.check(body);
  }
}
