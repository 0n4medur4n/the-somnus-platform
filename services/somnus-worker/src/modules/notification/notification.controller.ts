import { Body, Controller, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CloudTasksAuthGuard } from "./cloud-tasks-auth.guard.js";
import { NotificationTaskDto } from "./notification.dto.js";
import {
  NotificationService,
  NotificationTransientError,
  type ProcessOutcome,
} from "./notification.service.js";

/**
 * The Cloud Tasks consumer (build plan §5.7). Cloud Tasks POSTs a task here.
 * A 2xx acks the task (delivered, deduped, or dead-lettered — stop retrying);
 * a 503 tells Cloud Tasks to redeliver the same task for another attempt, up to
 * the module's max-attempts budget.
 */
@ApiTags("notifications")
@Controller({ path: "internal/v1/notifications" })
@UseGuards(CloudTasksAuthGuard)
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Post("tasks")
  @ApiOperation({ summary: "Consume a notification task (Cloud Tasks push target)." })
  async consume(@Body() body: NotificationTaskDto): Promise<{ outcome: ProcessOutcome }> {
    try {
      const result = await this.service.process(body);
      return { outcome: result.outcome };
    } catch (error) {
      if (error instanceof NotificationTransientError) {
        // Retryable: Cloud Tasks will redeliver with the same idempotency key.
        throw new ServiceUnavailableException("notification delivery failed; retry");
      }
      throw error;
    }
  }
}
