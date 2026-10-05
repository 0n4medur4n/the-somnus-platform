import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Patch,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { MeResponse } from "@somnus/api-contracts";
import type { FastifyReply } from "fastify";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { ProfilePatchDto } from "./me.dto.js";
import { MeService } from "./me.service.js";

/**
 * Session-guarded composition of the current actor's identity record.
 * `PATCH /v1/me/profile` is additionally CSRF-protected by the global
 * preHandler (see bootstrap/harden.ts) as a state-changing route.
 */
@ApiTags("me")
@Controller({ path: "v1/me" })
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({
    summary: "The current actor's user record and profile(s), composed from identity.",
  })
  async getMe(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<MeResponse> {
    return this.me.getMe(session, correlationId);
  }

  @Patch("profile")
  @HttpCode(204)
  @ApiOperation({ summary: "Patch the current actor's individual profile via identity." })
  async patchProfile(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: ProfilePatchDto,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.me.patchProfile(session, body, correlationId);
  }

  /**
   * The raw image is the body (image/webp or image/jpeg, at most 1 MB -- see
   * the content-type parser in bootstrap/harden.ts). CSRF-protected like every
   * other state-changing route.
   */
  @Put("photo")
  @HttpCode(204)
  @ApiOperation({ summary: "Upload or replace the current actor's profile photo." })
  async setPhoto(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: unknown,
    @Headers("content-type") contentType: string | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    const declared = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    await this.me.setPhoto(session, body, declared, correlationId);
  }

  @Get("photo")
  @ApiOperation({ summary: "The current actor's own profile photo." })
  async getPhoto(
    @CurrentSession() session: SessionRecord | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CorrelationId() correlationId?: string,
  ): Promise<Buffer> {
    const photo = await this.me.getPhoto(session, correlationId);
    // Private: only this browser may keep it. The app asks for it with the
    // photo's change time in the query, so a new photo is never served stale.
    reply.header("content-type", photo.type);
    reply.header("cache-control", "private, max-age=86400");
    reply.header("content-disposition", "inline");
    // Helmet's default is same-origin. Deployed, the app and this route share an
    // origin anyway; locally the SPA (:5173) and edge-api differ only by port,
    // which is the same site. Never cross-site: the photo is the person's own.
    reply.header("cross-origin-resource-policy", "same-site");
    return photo.bytes;
  }

  @Delete("photo")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove the current actor's profile photo." })
  async removePhoto(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.me.removePhoto(session, correlationId);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete the current actor's account (right to erasure); CSRF-protected.",
  })
  async deleteAccount(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.me.deleteAccount(session, correlationId);
  }
}
