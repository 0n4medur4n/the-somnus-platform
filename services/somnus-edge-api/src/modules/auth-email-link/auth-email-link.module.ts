import { Module } from "@nestjs/common";
import { AuthEmailLinkController } from "./auth-email-link.controller.js";
import { AuthEmailLinkService } from "./auth-email-link.service.js";

/** The sign-in link by email (FirebaseService and the worker client are global). */
@Module({
  controllers: [AuthEmailLinkController],
  providers: [AuthEmailLinkService],
})
export class AuthEmailLinkModule {}
