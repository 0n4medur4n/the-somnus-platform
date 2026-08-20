import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard.js";
import { AuditEventDto } from "./audit.dto.js";
import { AuditService, type RecordOutcome } from "./audit.service.js";

/**
 * The audit-event ingest endpoint (build plan §5.7). Services publish audit
 * events (§17 envelope) that land here (via Pub/Sub push in staging/production).
 * Idempotent by event id, so a redelivery is recorded once.
 */
@ApiTags("audit")
@Controller({ path: "internal/v1/audit" })
@UseGuards(InternalAuthGuard)
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Post("events")
  @ApiOperation({ summary: "Ingest an audit event (Pub/Sub push target)." })
  async ingest(@Body() body: AuditEventDto): Promise<{ outcome: RecordOutcome }> {
    const result = await this.service.record(body);
    return { outcome: result.outcome };
  }
}
