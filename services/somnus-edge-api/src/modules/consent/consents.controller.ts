import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ConsentReceipt, ConsentStatusListResponse } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { ConsentCreateDto, ConsentWithdrawDto } from "./consent.dto.js";
import { ConsentProxyService } from "./consent.service.js";

/**
 * Actor-scoped consent, session-guarded. The state-changing routes
 * (record, withdraw) are additionally CSRF-protected by the global
 * preHandler (bootstrap/harden.ts). edge-api forwards to identity's
 * consent module; it never records or evaluates consent itself.
 */
@ApiTags("consent")
@Controller({ path: "v1/consents" })
@UseGuards(SessionGuard)
export class ConsentsController {
  constructor(private readonly consent: ConsentProxyService) {}

  @Post()
  @ApiOperation({ summary: "Record consent for one purpose against its current document version." })
  async create(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: ConsentCreateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<ConsentReceipt> {
    return this.consent.record(session, body, correlationId);
  }

  @Get("current")
  @ApiOperation({ summary: "The actor's current consent standing for every purpose." })
  async current(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<ConsentStatusListResponse> {
    return this.consent.getCurrent(session, correlationId);
  }

  @Post(":receiptId/withdraw")
  @HttpCode(204)
  @ApiOperation({ summary: "Withdraw a previously granted consent. Immediately effective." })
  async withdraw(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("receiptId") receiptId: string,
    @Body() body: ConsentWithdrawDto,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.consent.withdraw(session, receiptId, body, correlationId);
  }
}
