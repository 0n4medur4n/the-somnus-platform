import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { DRIVE_MAX_BLOCKS, opaqueIdSchema } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

/** Set by edge-api from the server-side session, after identity granted `admin_drive`. */
export const ACTOR_ID_HEADER = "x-somnus-actor-id";
/** The session's email, sent only where an account is created or reset. */
export const ACTOR_EMAIL_HEADER = "x-somnus-actor-email";

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function refused(message: string): SomnusError {
  return new SomnusError(ErrorCode.UNAUTHENTICATED, message, { correlationId: "drive" });
}

/**
 * The acting person. Without a well-formed id there is nobody to act for, and
 * the request is refused before any Drive rule runs.
 */
export const DriveActor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const id = header(ctx.switchToHttp().getRequest<FastifyRequest>(), ACTOR_ID_HEADER);
  const parsed = opaqueIdSchema.safeParse(id);
  if (!parsed.success) throw refused("No acting user.");
  return parsed.data;
});

export const DriveActorEmail = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const email = header(ctx.switchToHttp().getRequest<FastifyRequest>(), ACTOR_EMAIL_HEADER);
  const parsed = z.email().max(320).safeParse(email);
  if (!parsed.success) throw refused("No acting user email.");
  return parsed.data;
});

function invalid(): SomnusError {
  return new SomnusError(ErrorCode.VALIDATION_FAILED, "Invalid path parameter.", {
    correlationId: "drive",
  });
}

export function idParam(value: string): string {
  const parsed = opaqueIdSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export function revisionParam(value: string): number {
  const parsed = z.coerce.number().int().min(1).max(1_000_000).safeParse(value);
  if (!parsed.success || !/^\d+$/.test(value)) throw invalid();
  return parsed.data;
}

export function blockIndexParam(value: string): number {
  const parsed = z.coerce
    .number()
    .int()
    .min(0)
    .max(DRIVE_MAX_BLOCKS - 1)
    .safeParse(value);
  if (!parsed.success || !/^\d+$/.test(value)) throw invalid();
  return parsed.data;
}
