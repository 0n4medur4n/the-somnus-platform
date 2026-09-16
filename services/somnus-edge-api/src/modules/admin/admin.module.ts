import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AdminProxyService } from "./admin.service.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminBreakGlassController } from "./admin-break-glass.controller.js";
import { AdminBreakGlassService } from "./admin-break-glass.service.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminContentReviewController } from "./admin-content-review.controller.js";
import { AdminContentReviewService } from "./admin-content-review.service.js";
import { AdminCorpusController } from "./admin-corpus.controller.js";
import { AdminCorpusService } from "./admin-corpus.service.js";
import { AdminInsightsController } from "./admin-insights.controller.js";
import { AdminInsightsService } from "./admin-insights.service.js";
import { AdminMeController } from "./admin-me.controller.js";
import { AdminOperationsController } from "./admin-operations.controller.js";

/**
 * The `/admin/v1/*` surface (Addendum A §A2.1 / Checkpoint 15.1). A separate
 * module, not a section of the consumer routes: its own guard, its own audit
 * interceptor, and a route table an architectural test can enumerate.
 *
 * Imports SessionsModule for `SessionGuard` and `ActorResolver`; the identity
 * client and the event publisher come from the global modules.
 */
@Module({
  imports: [SessionsModule],
  controllers: [
    AdminMeController,
    AdminOperationsController,
    AdminContentReviewController,
    AdminInsightsController,
    AdminBreakGlassController,
    AdminCorpusController,
  ],
  providers: [
    AdminProxyService,
    // Checkpoint 15.3: the review queue lives in `somnus_reporting`, so its
    // proxy targets the report service rather than identity (§7).
    AdminContentReviewService,
    AdminInsightsService,
    // Checkpoint 15.5: assessment results are morpheo's data (§7), so this
    // proxy targets morpheo rather than identity or the worker.
    AdminBreakGlassService,
    // Checkpoint 16.3: the reference corpus lives in `somnus_content`, owned by
    // the report service's isolated corpus module (ADR 0010), so this proxy
    // targets the report service too.
    AdminCorpusService,
    AdminCapabilityGuard,
    AdminAuditInterceptor,
  ],
})
export class AdminModule {}
