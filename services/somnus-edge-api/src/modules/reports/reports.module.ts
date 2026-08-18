import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportProxyService } from "./reports.service.js";

/**
 * Report proxy (build plan §20 Checkpoint 11.1). Imports SessionsModule for
 * `SessionGuard`; the report client comes from the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [ReportsController],
  providers: [ReportProxyService],
})
export class ReportsModule {}
