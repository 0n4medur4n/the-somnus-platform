import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type ContentReviewItem,
  ContentReviewItemSchema,
  type ContentReviewQueue,
  ContentReviewQueueSchema,
} from "@somnus/api-contracts";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { ContentReviewDecisionDto } from "./admin.dto.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminContentReviewService } from "./admin-content-review.service.js";
import { AdminRoute } from "./admin-route.decorator.js";

/**
 * The AI content review queue (Addendum A Checkpoint 15.3, build plan §15).
 *
 * Both routes require `admin_content_review`, which the §A2.2 matrix grants to
 * `clinical_governance_reviewer` and `platform_super_admin` and to nobody else --
 * `support_agent` and `platform_admin` included. That mapping lives in identity
 * (`admin-capability-policy.ts`); this controller only names the capability.
 *
 * Reads are audited as well as decisions: who read a queue of unreleased
 * AI-written clinical prose is exactly what an audit has to be able to answer.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminContentReviewController {
  constructor(private readonly review: AdminContentReviewService) {}

  private actor(session: SessionRecord | undefined): string {
    // The guard resolved and approved the actor before this handler ran.
    return session?.somnusUserId ?? "";
  }

  @Get("content-review/items")
  @AdminRoute({
    capability: "admin_content_review",
    eventType: "admin.content_review_queue.viewed.v1",
    entity: "content_review_item",
  })
  @ApiOperation({ summary: "The AI content review queue (pending items only)." })
  async queue(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<ContentReviewQueue> {
    return this.review.forward({
      method: "GET",
      path: "/internal/v1/admin/content-review/items",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: ContentReviewQueueSchema,
    });
  }

  @Post("content-review/items/:itemId/decision")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_content_review",
    eventType: "admin.content_review_item.decided.v1",
    entity: "content_review_item",
  })
  @ApiOperation({
    summary: "Approve or reject a candidate. Reason required for both outcomes.",
  })
  async decide(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("itemId") itemId: string,
    @Body() body: ContentReviewDecisionDto,
    @CorrelationId() correlationId?: string,
  ): Promise<ContentReviewItem> {
    const actorId = this.actor(session);
    return this.review.forward({
      method: "POST",
      path: `/internal/v1/admin/content-review/items/${encodeURIComponent(itemId)}/decision`,
      actorId,
      correlationId: correlationOf(correlationId),
      schema: ContentReviewItemSchema,
      // The reviewer's identity is the session's, never the client's: a console
      // that could name its own reviewer would make the audit trail worthless.
      body: { ...body, reviewerId: actorId },
    });
  }
}
