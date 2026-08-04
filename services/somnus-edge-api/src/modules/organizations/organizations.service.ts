import { Inject, Injectable } from "@nestjs/common";
import {
  type Invitation,
  type InvitationAcceptRequest,
  type InvitationCreateRequest,
  type InvitationCreateResponse,
  InvitationCreateResponseSchema,
  InvitationSchema,
  type Membership,
  MembershipSchema,
  type Organization,
  type OrganizationCreateRequest,
  OrganizationSchema,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { type ZodType, z } from "zod";
import { correlationOf, requireSession } from "../../common/composition.util.js";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { ActorResolver } from "../sessions/actor-resolver.service.js";
import type { SessionRecord } from "../sessions/session.service.js";

const MembershipListSchema = z.array(MembershipSchema);

/**
 * Proxies the organization + invitation surface needed by the SPA
 * golden path (build plan §20 Checkpoint 9.1). All routes are
 * actor-scoped; edge-api forwards the resolved actor to identity, which
 * owns every authorization decision (build plan §5.3: no authz logic
 * duplicated here).
 */
@Injectable()
export class OrganizationsProxyService {
  constructor(
    @Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient,
    private readonly actorResolver: ActorResolver,
  ) {}

  async create(
    session: SessionRecord | undefined,
    body: OrganizationCreateRequest,
    rawCorrelationId?: string,
  ): Promise<Organization> {
    const { correlationId, actorId } = await this.context(session, rawCorrelationId);
    const response = await this.identity.post("/v1/organizations", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body,
    });
    return this.parse(OrganizationSchema, response.body, correlationId);
  }

  async getById(
    session: SessionRecord | undefined,
    organizationId: string,
    rawCorrelationId?: string,
  ): Promise<Organization> {
    const { correlationId, actorId } = await this.context(session, rawCorrelationId);
    const response = await this.identity.get(
      `/v1/organizations/${encodeURIComponent(organizationId)}`,
      {
        correlationId,
        headers: { [ACTOR_ID_HEADER]: actorId },
      },
    );
    return this.parse(OrganizationSchema, response.body, correlationId);
  }

  async listMembers(
    session: SessionRecord | undefined,
    organizationId: string,
    rawCorrelationId?: string,
  ): Promise<Membership[]> {
    const { correlationId, actorId } = await this.context(session, rawCorrelationId);
    const response = await this.identity.get(
      `/v1/organizations/${encodeURIComponent(organizationId)}/members`,
      { correlationId, headers: { [ACTOR_ID_HEADER]: actorId } },
    );
    return this.parse(MembershipListSchema, response.body, correlationId);
  }

  async invite(
    session: SessionRecord | undefined,
    organizationId: string,
    body: InvitationCreateRequest,
    rawCorrelationId?: string,
  ): Promise<InvitationCreateResponse> {
    const { correlationId, actorId } = await this.context(session, rawCorrelationId);
    const response = await this.identity.post(
      `/v1/organizations/${encodeURIComponent(organizationId)}/invitations`,
      { correlationId, headers: { [ACTOR_ID_HEADER]: actorId }, body },
    );
    return this.parse(InvitationCreateResponseSchema, response.body, correlationId);
  }

  async acceptInvitation(
    session: SessionRecord | undefined,
    body: InvitationAcceptRequest,
    rawCorrelationId?: string,
  ): Promise<Invitation> {
    const { correlationId, actorId } = await this.context(session, rawCorrelationId);
    const response = await this.identity.post("/v1/invitations/accept", {
      correlationId,
      headers: { [ACTOR_ID_HEADER]: actorId },
      body,
    });
    return this.parse(InvitationSchema, response.body, correlationId);
  }

  private async context(
    session: SessionRecord | undefined,
    rawCorrelationId?: string,
  ): Promise<{ correlationId: string; actorId: string }> {
    const correlationId = correlationOf(rawCorrelationId);
    const actorId = await this.actorResolver.resolve(
      requireSession(session, correlationId),
      correlationId,
    );
    return { correlationId, actorId };
  }

  private parse<T>(schema: ZodType<T>, body: unknown, correlationId: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    return parsed.data;
  }
}
