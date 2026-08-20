import { Controller, Delete, HttpCode } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import { AccountDeletionService } from "./account-deletion.service.js";

/**
 * Account erasure endpoint (build plan §21 / Checkpoint 13.2). The edge calls this
 * as part of `DELETE /v1/me`; the actor id is the account owner's user id.
 */
@ApiTags("me")
@Controller({ path: "v1/me" })
export class AccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: "Erase the current actor's account (right to erasure)." })
  async deleteAccount(@CurrentActorId() actorId: string): Promise<void> {
    await this.service.eraseAccount(actorId);
  }
}
