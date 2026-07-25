import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { UserResolveResponse } from "@somnus/api-contracts";
import { UserResolveDto } from "./users.dto.js";
import { UsersResolveService } from "./users-resolve.service.js";

/**
 * Internal-only (build plan §16: `/internal/v1/` prefix, never exposed
 * through edge-api's public routes; the service is private, reachable
 * only by edge-api's service account per Terraform Checkpoint 5.1).
 * Resolves a Firebase provider user id into the internal Somnus user id
 * edge-api forwards as `x-somnus-actor-id`.
 */
@ApiTags("users")
@Controller({ path: "internal/v1/users" })
export class UsersResolveController {
  constructor(private readonly usersResolveService: UsersResolveService) {}

  @Post("resolve")
  @HttpCode(200)
  @ApiOperation({ summary: "Resolve a provider user id into the internal Somnus user id." })
  async resolve(@Body() body: UserResolveDto): Promise<UserResolveResponse> {
    return this.usersResolveService.resolveByProvider(body.providerUserId);
  }
}
