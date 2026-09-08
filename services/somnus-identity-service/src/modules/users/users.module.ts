import { Module } from "@nestjs/common";
import { ConsentModule } from "../consent/consent.module.js";
import { UsersProvisionController } from "./users-provision.controller.js";
import { UsersProvisionService } from "./users-provision.service.js";
import { UsersResolveController } from "./users-resolve.controller.js";
import { UsersResolveService } from "./users-resolve.service.js";

/**
 * The internal user resolve + provision endpoints (build plan §20
 * Checkpoints 8.2 and 9.1). `UsersRepository` and
 * `IndividualProfilesRepository` come from the global `DbModule`.
 *
 * Imports `ConsentModule` solely to reach `ConsentService`, the module's public
 * interface (build plan §261 / Checkpoint 7.1). Registration records consent
 * receipts through that service and never touches consent's own tables,
 * repositories or `somnus_consent` database.
 */
@Module({
  imports: [ConsentModule],
  controllers: [UsersResolveController, UsersProvisionController],
  providers: [UsersResolveService, UsersProvisionService],
})
export class UsersModule {}
