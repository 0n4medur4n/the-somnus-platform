import { Module } from "@nestjs/common";
import { VerificationCasesController } from "./verification-cases.controller.js";
import { VerificationCasesService } from "./verification-cases.service.js";

@Module({
  controllers: [VerificationCasesController],
  providers: [VerificationCasesService],
})
export class VerificationCasesModule {}
