import { Module } from "@nestjs/common";
import { AuthorizationService } from "../../domain/authorization/authorization.service.js";
import { ConsentModule } from "../consent/consent.module.js";
import {
  AdminAuthorizationController,
  AuthorizationController,
} from "./authorization.controller.js";

@Module({
  imports: [ConsentModule],
  controllers: [AuthorizationController, AdminAuthorizationController],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
