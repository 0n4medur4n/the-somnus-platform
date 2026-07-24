import { Module } from "@nestjs/common";
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
import { ConsentModule } from "../consent/consent.module.js";
import { AuthorizationController } from "./authorization.controller.js";

@Module({
  imports: [ConsentModule],
  controllers: [AuthorizationController],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
