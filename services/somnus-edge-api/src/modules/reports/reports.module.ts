import { Module } from "@nestjs/common";
import { MorpheoModule } from "../morpheo/morpheo.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { PersonReportController } from "./person-report.controller.js";
import { ReportsController } from "./reports.controller.js";
import { ReportProxyService } from "./reports.service.js";

/**
 * Report proxy (build plan §20 Checkpoint 11.1). Imports SessionsModule for
 * `SessionGuard`; the report client comes from the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule, MorpheoModule],
  controllers: [ReportsController, PersonReportController],
  providers: [ReportProxyService],
})
export class ReportsModule {}
