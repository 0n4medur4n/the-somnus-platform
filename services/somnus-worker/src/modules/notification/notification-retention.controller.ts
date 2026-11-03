import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { NotificationErasureResult } from "@somnus/api-contracts";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard.js";
import { NotificationRecipientEraseDto } from "./notification.dto.js";
import { NotificationService } from "./notification.service.js";

/**
 * What the Notification module forgets, and when. Separate from the Cloud Tasks
 * consumer because the callers differ: the edge at account deletion, and Cloud
 * Scheduler for the retention purge, both through the internal guard.
 */
@ApiTags("notifications")
@Controller({ path: "internal/v1/notifications" })
@UseGuards(InternalAuthGuard)
export class NotificationRetentionController {
  constructor(private readonly service: NotificationService) {}

  @Post("recipient/erase")
  @HttpCode(200)
  @ApiOperation({ summary: "Account deletion: erase every delivery record for this email." })
  erase(@Body() body: NotificationRecipientEraseDto): Promise<NotificationErasureResult> {
    return this.service.eraseRecipient(body.email);
  }

  @Post("purge")
  @HttpCode(200)
  @ApiOperation({ summary: "Delete delivery records past their retention (90 days by default)." })
  purge(): Promise<NotificationErasureResult> {
    return this.service.purgeExpired();
  }
}
