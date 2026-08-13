import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  AssessmentClaimResponse,
  AssessmentClaimTokenResponse,
  AssessmentCreateResponse,
  AssessmentResult,
  AssessmentSnapshotResponse,
} from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AnswerSubmitDto, AssessmentClaimDto, AssessmentCreateDto } from "./morpheo.dto.js";
import { MorpheoProxyService } from "./morpheo.service.js";

/**
 * The anonymous assessment surface (build plan §20 Checkpoint 10.3). Create,
 * answer, summary, and mint-token are anonymous (no session); claim and
 * snapshot require an authenticated session and forward the resolved actor.
 * edge-api forwards to morpheo's private endpoints; it never runs the engine.
 */
@ApiTags("assessments")
@Controller({ path: "v1/assessments" })
export class AssessmentsController {
  constructor(private readonly morpheo: MorpheoProxyService) {}

  @Post()
  @ApiOperation({ summary: "Open an anonymous assessment session." })
  create(
    @Body() body: AssessmentCreateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AssessmentCreateResponse> {
    return this.morpheo.create(body, correlationId);
  }

  @Post(":sessionId/answers")
  @ApiOperation({ summary: "Submit one validated answer and re-evaluate." })
  submitAnswer(
    @Param("sessionId") sessionId: string,
    @Body() body: AnswerSubmitDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AssessmentResult> {
    return this.morpheo.submitAnswer(sessionId, body, correlationId);
  }

  @Get(":sessionId/summary")
  @ApiOperation({ summary: "The current deterministic result." })
  summary(
    @Param("sessionId") sessionId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<AssessmentResult> {
    return this.morpheo.summary(sessionId, correlationId);
  }

  @Post(":sessionId/claim-token")
  @ApiOperation({ summary: "Mint a single-use claim token for the auth handoff." })
  claimToken(
    @Param("sessionId") sessionId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<AssessmentClaimTokenResponse> {
    return this.morpheo.requestClaimToken(sessionId, correlationId);
  }

  @Post("claim")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Claim an assessment (authenticated, exactly once)." })
  claim(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AssessmentClaimDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AssessmentClaimResponse> {
    return this.morpheo.claim(session, body, correlationId);
  }

  @Get(":sessionId/snapshot")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "The immutable snapshot frozen at claim (authenticated)." })
  snapshot(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("sessionId") sessionId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<AssessmentSnapshotResponse> {
    return this.morpheo.snapshot(session, sessionId, correlationId);
  }
}
