import { Module } from "@nestjs/common";
import { UsersProvisionController } from "./users-provision.controller.js";
import { UsersProvisionService } from "./users-provision.service.js";
import { UsersResolveController } from "./users-resolve.controller.js";
import { UsersResolveService } from "./users-resolve.service.js";

/**
 * The internal user resolve + provision endpoints (build plan §20
 * Checkpoints 8.2 and 9.1). `UsersRepository` and
 * `IndividualProfilesRepository` come from the global `DbModule`.
 */
@Module({
  controllers: [UsersResolveController, UsersProvisionController],
  providers: [UsersResolveService, UsersProvisionService],
})
export class UsersModule {}
