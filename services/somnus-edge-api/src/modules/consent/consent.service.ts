import { Inject, Injectable } from "@nestjs/common";
import {
  type ConsentCreateRequest,
  type ConsentReceipt,
  ConsentReceiptSchema,
  type ConsentStatusListResponse,
  ConsentStatusListResponseSchema,
  type ConsentWithdrawRequest,
  type CurrentLegalDocumentsResponse,
  CurrentLegalDocumentsResponseSchema,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import type { SessionRecord } from "../sessions/session.service.js";

/**
 * Proxies the consent surface (build plan §20 Checkpoint 8.2). The
 * consent module lives inside the private identity service; edge-api
 * only forwards -- it never re-implements consent logic (build plan
 * §5.3). Legal-document reads are public; the rest are actor-scoped.
 */
@Injectable()
export class ConsentProxyService {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly actorResolver: ActorResolver,
  ) {}

  async getLegalDocuments(
    locale: string | undefined,
    rawCorrelationId?: string,
  ): Promise<CurrentLegalDocumentsResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.identity.get("/v1/legal-documents/current", {
      correlationId,
      ...(locale ? { query: { locale } } : {}),
    });
    return this.parse(CurrentLegalDocumentsResponseSchema, response.body, correlationId);
  }

  async getCurrent(
    session: SessionRecord | undefined,
    rawCorrelationId?: string,
  ): Promise<ConsentStatusListResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.resolveActor(session, correlationId);
    const response = await this.identity.get("/v1/consents/current", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
    });
    return this.parse(ConsentStatusListResponseSchema, response.body, correlationId);
  }

  async record(
    session: SessionRecord | undefined,
    body: ConsentCreateRequest,
    rawCorrelationId?: string,
  ): Promise<ConsentReceipt> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.resolveActor(session, correlationId);
    const response = await this.identity.post("/v1/consents", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body,
    });
    return this.parse(ConsentReceiptSchema, response.body, correlationId);
  }

  async withdraw(
    session: SessionRecord | undefined,
    receiptId: string,
    body: ConsentWithdrawRequest,
    rawCorrelationId?: string,
  ): Promise<void> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.resolveActor(session, correlationId);
    await this.identity.post(`/v1/consents/${encodeURIComponent(receiptId)}/withdraw`, {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body,
    });
  }

  private resolveActor(session: SessionRecord | undefined, correlationId: string): Promise<string> {
    return this.actorResolver.resolve(requireSession(session, correlationId), correlationId);
  }

  private parse<T>(schema: ZodType<T>, body: unknown, correlationId: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    return parsed.data;
  }
}
