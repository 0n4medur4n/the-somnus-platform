import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FunnelConfigResponse, FunnelState } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { OptionalSessionGuard } from "../sessions/optional-session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { FunnelAnswerDto, FunnelCreateDto, FunnelRewindDto } from "./funnel.dto.js";
import { FunnelProxyService } from "./funnel.service.js";

/** `?panel=1`: the app asks for the team panel (kept only for internal roles). */
const wantsPanel = (panel: string | undefined) => panel === "1" || panel === "true";

/**
 * The v2 interview (the embudo v0.2, ADR 0020). Open to everyone; a signed-in
 * person's interview is saved to them from the start. The engine in morpheo
 * serves each step; the app shows it and answers it.
 */
@ApiTags("funnel")
@Controller({ path: "v1/funnel" })
@UseGuards(OptionalSessionGuard)
export class FunnelController {
  constructor(private readonly funnel: FunnelProxyService) {}

  @Get("config")
  @ApiOperation({ summary: "Which assessment flow the app runs (v1 or v2)." })
  config(@CorrelationId() correlationId?: string): Promise<FunnelConfigResponse> {
    return this.funnel.config(correlationId);
  }

  @Post("sessions")
  @ApiOperation({ summary: "Start an interview (health-data consent); returns the first step." })
  create(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: FunnelCreateDto,
    @Query("panel") panel?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelState> {
    return this.funnel.create(session, body, wantsPanel(panel), correlationId);
  }

  @Get("sessions/:sessionId")
  @ApiOperation({ summary: "The interview as it stands: the step to show, or the result." })
  get(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("sessionId") sessionId: string,
    @Query("panel") panel?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelState> {
    return this.funnel.get(session, sessionId, wantsPanel(panel), correlationId);
  }

  @Post("sessions/:sessionId/answers")
  @ApiOperation({ summary: "Answer the step being served; returns the next step or the result." })
  answer(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("sessionId") sessionId: string,
    @Body() body: FunnelAnswerDto,
    @Query("panel") panel?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelState> {
    return this.funnel.answer(session, sessionId, body, wantsPanel(panel), correlationId);
  }

  @Post("sessions/:sessionId/back")
  @ApiOperation({ summary: "Undo the last answer (the back button)." })
  back(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("sessionId") sessionId: string,
    @Query("panel") panel?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelState> {
    return this.funnel.back(session, sessionId, wantsPanel(panel), correlationId);
  }

  @Post("sessions/:sessionId/rewind")
  @ApiOperation({ summary: "Go back to an answer to change it (Z1 correction)." })
  rewind(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("sessionId") sessionId: string,
    @Body() body: FunnelRewindDto,
    @Query("panel") panel?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelState> {
    return this.funnel.rewind(session, sessionId, body, wantsPanel(panel), correlationId);
  }
}
