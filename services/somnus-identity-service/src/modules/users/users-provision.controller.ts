import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type UserProvisionRequest,
  UserProvisionRequestSchema,
  type UserResolveResponse,
} from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
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
  @ApiBody({ type: UserProvisionDto })
  async provision(
    @Body(new ZodValidationPipe(UserProvisionRequestSchema)) body: UserProvisionRequest,
    @CorrelationId() correlationId: string | undefined,
  ): Promise<UserResolveResponse> {
    return this.usersProvisionService.provision(body, correlationId);
  }
}
