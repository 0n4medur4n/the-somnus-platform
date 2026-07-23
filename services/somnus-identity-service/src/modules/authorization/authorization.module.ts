import { Module } from "@nestjs/common";
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
import { AuthorizationController } from "./authorization.controller.js";

@Module({
  controllers: [AuthorizationController],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
