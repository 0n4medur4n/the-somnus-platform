import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ConsentReceipt, ConsentStatusListResponse } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { ConsentCreateDto, ConsentWithdrawDto } from "./consent.dto.js";
import { ConsentService } from "./consent.service.js";

@ApiTags("consent")
@Controller({ path: "v1/consents" })
export class ConsentsController {
  constructor(private readonly consentService: ConsentService) {}

  @Post()
  @ApiOperation({ summary: "Record consent for one purpose against its current document version." })
  async create(
    @CurrentActorId() actorId: string,
    @Body() body: ConsentCreateDto,
    @CorrelationId() correlationId: string | undefined,
  ): Promise<ConsentReceipt> {
    return this.consentService.record({
      userId: actorId,
      request: body,
      correlationId: correlationId ?? actorId,
    });
  }

  @Get("current")
  @ApiOperation({ summary: "The actor's current consent standing for every purpose." })
  async current(@CurrentActorId() actorId: string): Promise<ConsentStatusListResponse> {
    return this.consentService.getStatus(actorId);
  }

  @Post(":receiptId/withdraw")
  @HttpCode(204)
  @ApiOperation({ summary: "Withdraw a previously granted consent. Immediately effective." })
  async withdraw(
    @CurrentActorId() actorId: string,
    @Param("receiptId") receiptId: string,
    @Body() body: ConsentWithdrawDto,
    @CorrelationId() correlationId: string | undefined,
  ): Promise<void> {
    await this.consentService.withdraw({
      userId: actorId,
      receiptId,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      correlationId: correlationId ?? actorId,
    });
  }
}
