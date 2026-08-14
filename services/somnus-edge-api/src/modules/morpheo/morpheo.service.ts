import { Inject, Injectable } from "@nestjs/common";
import {
  type AnswerSubmitRequest,
  type AssessmentClaimRequest,
  type AssessmentClaimResponse,
  AssessmentClaimResponseSchema,
  type AssessmentClaimTokenResponse,
  AssessmentClaimTokenResponseSchema,
  type AssessmentContentResponse,
  AssessmentContentResponseSchema,
  type AssessmentCreateRequest,
  type AssessmentCreateResponse,
  AssessmentCreateResponseSchema,
  type AssessmentResult,
  AssessmentResultSchema,
  type AssessmentSnapshotResponse,
  AssessmentSnapshotResponseSchema,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import { MORPHEO_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import type { SessionRecord } from "../sessions/session.service.js";

const ASSESSMENTS = "/internal/v1/assessments";

/**
 * Proxies the anonymous assessment flow to the private morpheo service
 * (build plan §20 Checkpoint 10.3). edge-api only forwards — it never runs
 * the clinical engine (build plan §5.5, no Morpheo scoring in the BFF).
 *
 * create / submit answer / summary / mint claim-token are anonymous. Claim
 * and snapshot are actor-scoped: the edge resolves the authenticated Somnus
 * user and forwards it as `x-somnus-actor-id`, so the browser never supplies
 * the claimant identity.
 */
@Injectable()
export class MorpheoProxyService {
  constructor(
    @Inject(MORPHEO_CLIENT) private readonly morpheo: CloudRunClient,
    private readonly actorResolver: ActorResolver,
  ) {}

  async content(rawCorrelationId?: string): Promise<AssessmentContentResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.morpheo.get(`${ASSESSMENTS}/content`, { correlationId });
    return this.parse(AssessmentContentResponseSchema, response.body, correlationId);
  }

  async create(
    body: AssessmentCreateRequest,
    rawCorrelationId?: string,
  ): Promise<AssessmentCreateResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.morpheo.post(ASSESSMENTS, { correlationId, body });
    return this.parse(AssessmentCreateResponseSchema, response.body, correlationId);
  }

  async submitAnswer(
    sessionId: string,
    body: AnswerSubmitRequest,
    rawCorrelationId?: string,
  ): Promise<AssessmentResult> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.morpheo.post(
      `${ASSESSMENTS}/${encodeURIComponent(sessionId)}/answers`,
      {
        correlationId,
        body,
      },
    );
    return this.parse(AssessmentResultSchema, response.body, correlationId);
  }

  async summary(sessionId: string, rawCorrelationId?: string): Promise<AssessmentResult> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.morpheo.get(
      `${ASSESSMENTS}/${encodeURIComponent(sessionId)}/summary`,
      {
        correlationId,
      },
    );
    return this.parse(AssessmentResultSchema, response.body, correlationId);
  }

  async requestClaimToken(
    sessionId: string,
    rawCorrelationId?: string,
  ): Promise<AssessmentClaimTokenResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.morpheo.post(
      `${ASSESSMENTS}/${encodeURIComponent(sessionId)}/claim-token`,
      { correlationId },
    );
    return this.parse(AssessmentClaimTokenResponseSchema, response.body, correlationId);
  }

  async claim(
    session: SessionRecord | undefined,
    body: AssessmentClaimRequest,
    rawCorrelationId?: string,
  ): Promise<AssessmentClaimResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.resolveActor(session, correlationId);
    const response = await this.morpheo.post(`${ASSESSMENTS}/claim`, {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body,
    });
    return this.parse(AssessmentClaimResponseSchema, response.body, correlationId);
  }

  async snapshot(
    session: SessionRecord | undefined,
    sessionId: string,
    rawCorrelationId?: string,
  ): Promise<AssessmentSnapshotResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.resolveActor(session, correlationId);
    const response = await this.morpheo.get(
      `${ASSESSMENTS}/${encodeURIComponent(sessionId)}/snapshot`,
      {
        correlationId,
        headers: { [ACTOR_ID_HEADER]: actorId },
      },
    );
    return this.parse(AssessmentSnapshotResponseSchema, response.body, correlationId);
  }

  private resolveActor(session: SessionRecord | undefined, correlationId: string): Promise<string> {
    return this.actorResolver.resolve(requireSession(session, correlationId), correlationId);
  }

  private parse<T>(schema: ZodType<T>, body: unknown, correlationId: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected morpheo response.", { correlationId });
    }
    return parsed.data;
  }
}
