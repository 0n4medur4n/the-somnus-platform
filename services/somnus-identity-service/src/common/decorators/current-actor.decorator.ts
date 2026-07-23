import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { FastifyRequest } from "fastify";

export const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * Trust boundary (build plan §11: "The Somnus authorizes the
 * action"): somnus-identity-service is private -- Terraform
 * Checkpoint 5.1 sets INGRESS_TRAFFIC_INTERNAL_ONLY plus an explicit
 * roles/run.invoker binding restricted to somnus-edge-api's service
 * account, so nothing else can reach this service at all. Build plan
 * Phase 8 has edge-api verify the caller's Firebase session and
 * forward the resolved Somnus user id in this header. Until edge-api
 * exists, callers (including tests) set the header directly -- this
 * decorator does not itself perform any authentication, only reads
 * who the trusted upstream caller already identified.
 */
export const CurrentActorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { correlationId?: string }>();
    const raw = req.headers[ACTOR_ID_HEADER];
    const actorId = Array.isArray(raw) ? raw[0] : raw;
    if (!actorId) {
      throw new SomnusError(ErrorCode.UNAUTHENTICATED, "Missing actor identity.", {
        correlationId: req.correlationId ?? "unknown",
      });
    }
    return actorId;
  },
);
