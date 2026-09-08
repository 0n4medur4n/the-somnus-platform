import { Module } from "@nestjs/common";
import { ConsentModule } from "../consent/consent.module.js";
import { AccountDeletionController } from "./account-deletion.controller.js";
import { AccountDeletionService } from "./account-deletion.service.js";

/**
 * Account erasure (build plan §21 / Checkpoint 13.2). Imports ConsentModule for
 * its public `ConsentService`; the DB repositories come from the global DbModule.
 */
@Module({
  imports: [ConsentModule],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService],
  // Exported so the admin console can complete a deletion request through the
  // SAME erasure the user own DELETE /v1/me runs, never a second path.
  exports: [AccountDeletionService],
})
export class AccountModule {}
