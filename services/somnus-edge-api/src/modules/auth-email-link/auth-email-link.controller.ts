import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SignInLinkRequestSchema } from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { AuthEmailLinkService } from "./auth-email-link.service.js";

export class SignInLinkRequestDto extends createZodDto(SignInLinkRequestSchema) {}

/**
 * Public and pre-login, like `POST /v1/sessions`: there is no session yet, so it
 * is CSRF-exempt (bootstrap/harden.ts) and instead tightly rate-limited per IP,
 * on top of the per-address limit in the service. Always 204, whether or not an
 * account exists, and whether or not this request was throttled.
 */
@ApiTags("auth")
@Controller({ path: "v1/auth" })
export class AuthEmailLinkController {
  constructor(private readonly links: AuthEmailLinkService) {}

  @Post("email-link")
  @HttpCode(204)
  @RouteConfig({ rateLimit: { max: 5, timeWindow: 10 * 60_000 } })
  @ApiOperation({ summary: "Email a passwordless sign-in link, sent from The Somnus's domain." })
  async request(
    @Body() body: SignInLinkRequestDto,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.links.send(body, correlationId);
  }
}
