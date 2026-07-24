import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { SessionRecord } from "./session.service.js";

/**
 * The cookie holding the opaque, signed session id. HttpOnly, so the
 * SPA's JavaScript can never read it (build plan §21 / §5.2: no tokens
 * in browser storage -- and the session id is functionally a token).
 */
export const SESSION_COOKIE_NAME_DEFAULT = "somnus_session";

/** Populated by SessionGuard after a successful validate(); read by controllers. */
export type RequestWithSession = FastifyRequest & { session?: SessionRecord };

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionRecord | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithSession>();
    return req.session;
  },
);
