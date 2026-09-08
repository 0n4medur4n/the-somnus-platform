import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AdminProxyService } from "./admin.service.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminContentReviewController } from "./admin-content-review.controller.js";
import { AdminContentReviewService } from "./admin-content-review.service.js";
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
  controllers: [AdminMeController, AdminOperationsController, AdminContentReviewController],
  providers: [
    AdminProxyService,
    // Checkpoint 15.3: the review queue lives in `somnus_reporting`, so its
    // proxy targets the report service rather than identity (§7).
    AdminContentReviewService,
    AdminCapabilityGuard,
    AdminAuditInterceptor,
  ],
})
export class AdminModule {}
