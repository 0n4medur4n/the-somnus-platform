import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  AdminCapabilityCheckResponse,
  AdminContextResponse,
  AuthorizationCheckResponse,
} from "@somnus/api-contracts";
import {
  AdminCapabilityCheckDto,
  AdminContextDto,
  AuthorizationCheckDto,
} from "../../common/dto/identity.dto.js";
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

/**
 * The admin console's gate (Addendum A §A2.2 / Checkpoint 15.1). Internal-only,
 * like every other authorization surface: edge-api asks, identity decides.
 * edge-api holds no part of the capability matrix (build plan §5.3).
 */
@ApiTags("authorization")
@Controller({ path: "internal/v1/authorization" })
export class AdminAuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @Post("admin-check")
  @HttpCode(200)
  @ApiOperation({ summary: "May this actor use this admin capability? (Addendum A §A2.2)" })
  async adminCheck(@Body() body: AdminCapabilityCheckDto): Promise<AdminCapabilityCheckResponse> {
    return this.authorizationService.checkAdminCapability(body);
  }

  @Post("admin-context")
  @HttpCode(200)
  @ApiOperation({ summary: "The actor's internal roles and resolved capabilities." })
  async adminContext(@Body() body: AdminContextDto): Promise<AdminContextResponse> {
    return this.authorizationService.adminContext(body.actorUserId);
  }
}
