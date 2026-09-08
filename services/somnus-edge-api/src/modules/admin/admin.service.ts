import { Inject, Injectable } from "@nestjs/common";
import {
  type AdminCapability,
  type AdminCapabilityCheckResponse,
  AdminCapabilityCheckResponseSchema,
  type AdminContextResponse,
  AdminContextResponseSchema,
  type AdminMeResponse,
  MeResponseSchema,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { type ZodType } from "zod";
import { ACTOR_ID_HEADER } from "../../infrastructure/internal-clients/headers.js";
import { IDENTITY_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/**
 * The admin console's proxy into identity (Addendum A Checkpoint 15.1).
 *
 * Every decision here is identity's; this only forwards and shapes. Build plan
 * §5.3: edge-api duplicates no authorization logic, and the A2.2 matrix lives
 * in identity's pure policy.
 */
@Injectable()
export class AdminProxyService {
  constructor(@Inject(IDENTITY_CLIENT) private readonly identity: CloudRunClient) {}

  async checkCapability(
    actorId: string,
    capability: AdminCapability,
    correlationId: string,
  ): Promise<AdminCapabilityCheckResponse> {
    const response = await this.identity.post("/internal/v1/authorization/admin-check", {
      correlationId,
      body: { actorUserId: actorId, capability },
    });
    return this.parse(AdminCapabilityCheckResponseSchema, response.body, correlationId);
  }

  async context(actorId: string, correlationId: string): Promise<AdminContextResponse> {
    const response = await this.identity.post("/internal/v1/authorization/admin-context", {
      correlationId,
      body: { actorUserId: actorId },
    });
    return this.parse(AdminContextResponseSchema, response.body, correlationId);
  }

  /**
   * The shell's gate: holding ANY internal role is what makes someone an admin
   * at all. Which capabilities they then have is a separate, per-route question.
   */
  async hasAnyInternalRole(
    actorId: string,
    correlationId: string,
  ): Promise<{ allowed: boolean; reasonCode: string }> {
    const context = await this.context(actorId, correlationId);
    return context.roleKeys.length > 0
      ? { allowed: true, reasonCode: "AUTHORIZED_BY_INTERNAL_ROLE" }
      : { allowed: false, reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE" };
  }

  /**
   * `GET /admin/v1/me`. The console renders from `capabilities`, so it can
   * never show a control identity would refuse. Profiles are deliberately not
   * included: the console shows who is signed in, not their clinical profile.
   */
  async me(actorId: string, correlationId: string): Promise<AdminMeResponse> {
    const [meResponse, context] = await Promise.all([
      this.identity.get("/v1/me", {
        correlationId,
        headers: { [ACTOR_ID_HEADER]: actorId },
      }),
      this.context(actorId, correlationId),
    ]);
    const me = this.parse(MeResponseSchema, meResponse.body, correlationId);
    return { user: me.user, roleKeys: context.roleKeys, capabilities: context.capabilities };
  }

  /**
   * Forwards an admin operation to identity with the acting admin attached.
   *
   * Everything under `/admin/v1` that is not the shell goes through here, and
   * every response is parsed against its contract before it reaches the console
   * -- so a shape identity did not promise is an INTERNAL error, never something
   * the console renders as fact.
   */
  async forward<T>(input: {
    method: "GET" | "POST" | "PATCH";
    path: string;
    actorId: string;
    correlationId: string;
    schema: ZodType<T>;
    body?: unknown;
  }): Promise<T> {
    const headers = { [ACTOR_ID_HEADER]: input.actorId };
    const options = { correlationId: input.correlationId, headers };
    const response =
      input.method === "GET"
        ? await this.identity.get(input.path, options)
        : input.method === "POST"
          ? await this.identity.post(input.path, { ...options, body: input.body ?? {} })
          : await this.identity.patch(input.path, { ...options, body: input.body ?? {} });
    return this.parse(input.schema, response.body, input.correlationId);
  }

  private parse<T>(schema: ZodType<T>, body: unknown, correlationId: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected identity response.", { correlationId });
    }
    return parsed.data;
  }
}
