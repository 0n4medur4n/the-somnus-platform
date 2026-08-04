import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { UserResolveResponse } from "@somnus/api-contracts";
import { UserProvisionDto } from "./users.dto.js";
import { UsersProvisionService } from "./users-provision.service.js";

/**
 * Internal-only (build plan §16 `/internal/v1/`; the service is private,
 * reachable only by edge-api's service account). Find-or-create the
 * Somnus user for a Firebase identity during registration. Returns 200
 * because it is idempotent -- it may or may not have created a row.
 */
@ApiTags("users")
@Controller({ path: "internal/v1/users" })
export class UsersProvisionController {
  constructor(private readonly usersProvisionService: UsersProvisionService) {}

  @Post("provision")
  @HttpCode(200)
  @ApiOperation({ summary: "Find-or-create the Somnus user for a Firebase identity." })
  async provision(@Body() body: UserProvisionDto): Promise<UserResolveResponse> {
    return this.usersProvisionService.provision(body);
  }
}
