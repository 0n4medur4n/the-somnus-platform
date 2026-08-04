import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { RegistrationController } from "./registration.controller.js";
import { RegistrationService } from "./registration.service.js";

@Module({
  imports: [SessionsModule],
  controllers: [RegistrationController],
  providers: [RegistrationService],
})
export class RegistrationModule {}
