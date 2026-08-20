import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard.js";
import { MaintenanceService } from "./maintenance.service.js";

/**
 * The scheduled-job targets (build plan §5.7 / §12.2). Cloud Scheduler POSTs here
 * on a cron; each call returns the number of rows Morpheo deleted. Guarded like
 * the other internal endpoints.
 */
@ApiTags("jobs")
@Controller({ path: "internal/v1/jobs" })
@UseGuards(InternalAuthGuard)
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  @Post("cleanup-unclaimed-assessments")
  @ApiOperation({ summary: "Delete unclaimed assessments past the 30-day TTL." })
  cleanupUnclaimedAssessments(): Promise<MaintenanceDeleteResult> {
    return this.service.cleanupUnclaimedAssessments();
  }

  @Post("cleanup-claim-tokens")
  @ApiOperation({ summary: "Delete claim tokens past the 72 h TTL." })
  cleanupClaimTokens(): Promise<MaintenanceDeleteResult> {
    return this.service.cleanupExpiredClaimTokens();
  }
}
