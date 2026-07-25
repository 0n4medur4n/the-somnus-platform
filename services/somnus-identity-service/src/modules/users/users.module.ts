import { Module } from "@nestjs/common";
import { UsersResolveController } from "./users-resolve.controller.js";
import { UsersResolveService } from "./users-resolve.service.js";

/**
 * The internal user-resolution endpoint (build plan §20 Checkpoint
 * 8.2). `UsersRepository` comes from the global `DbModule`.
 */
@Module({
  controllers: [UsersResolveController],
  providers: [UsersResolveService],
})
export class UsersModule {}
