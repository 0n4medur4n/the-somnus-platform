import { Body, Controller, Delete, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { SessionResponse } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { FastifyReply } from "fastify";
import { type EdgeConfig, loadEdgeConfig } from "../../config/edge-config.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";
import { CurrentSession } from "./current-session.decorator.js";
// biome-ignore lint/style/useImportType: used as a @Body() parameter type -- nestjs-zod's global ZodValidationPipe needs a real import to recognize and validate this DTO class at runtime.
import { SessionCreateDto } from "./session.dto.js";
import { SessionGuard } from "./session.guard.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import { type SessionRecord, SessionService } from "./session.service.js";

/** Readable (non-HttpOnly) cookie carrying the CSRF token for the SPA to echo in a header (double-submit). */
const CSRF_TOKEN_COOKIE = "somnus_csrf";

@ApiTags("sessions")
@Controller({ path: "v1/sessions" })
export class SessionsController {
  private readonly config: EdgeConfig = loadEdgeConfig(process.env);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Exchange a Firebase ID token for a server-side session cookie
   * (build plan §10). NOT CSRF-protected: it is the bootstrap that
   * establishes the session, and is instead protected by requiring a
   * valid, freshly-issued Firebase ID token. A forged or expired token
   * is rejected by verifyIdToken.
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Exchange a Firebase ID token for a session cookie." })
  async create(
    @Body() body: SessionCreateDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    let firebaseUid: string;
    let email: string | null;
    try {
      const decoded = await this.firebase.verifyIdToken(body.idToken);
      firebaseUid = decoded.uid;
      email = decoded.email ?? null;
    } catch {
      // Forged, malformed, expired, or wrong-project token: all one
      // 401, no detail leaked about which.
      throw new SomnusError(ErrorCode.UNAUTHENTICATED, "Authentication is required.", {
        correlationId: "sessions",
      });
    }

    const session = await this.sessions.create({
      firebaseUid,
      email,
      ttlSeconds: this.config.SESSION_TTL_SECONDS,
    });

    reply.setCookie(
      this.config.SESSION_COOKIE_NAME,
      session.sessionId,
      this.sessionCookieOptions(),
    );

    // Issue a CSRF token bound to this session. generateCsrf sets the
    // HttpOnly secret cookie; we hand the token to the SPA via a
    // readable cookie it echoes back in the x-csrf-token header.
    const csrfToken = reply.generateCsrf(this.csrfSecretCookieOptions());
    reply.setCookie(CSRF_TOKEN_COOKIE, csrfToken, this.csrfTokenCookieOptions());

    return {
      firebaseUid: session.firebaseUid,
      email: session.email,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * Revoke the current session and clear the cookies. Guarded (needs a
   * valid session) and CSRF-protected (a state-changing request that
   * rides the session cookie -- see the global CSRF preHandler in
   * main.ts). Idempotent revoke, so a double logout is not an error.
   */
  @Delete("current")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Revoke the current session and clear its cookies." })
  async destroy(
    @CurrentSession() session: SessionRecord | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (session) await this.sessions.revoke(session.sessionId);
    reply.clearCookie(this.config.SESSION_COOKIE_NAME, this.clearCookieOptions());
    reply.clearCookie(CSRF_TOKEN_COOKIE, this.clearCookieOptions(false));
    reply.clearCookie("_csrf", this.clearCookieOptions());
  }

  private sessionCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: this.config.COOKIE_SAMESITE,
      signed: true,
      path: "/",
      maxAge: this.config.SESSION_TTL_SECONDS,
      ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}),
    } as const;
  }

  /** The CSRF secret cookie: HttpOnly (the SPA never reads the secret, only the token). */
  private csrfSecretCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: this.config.COOKIE_SAMESITE,
      path: "/",
      ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}),
    } as const;
  }

  /** The CSRF token cookie: readable by the SPA (httpOnly:false) so it can echo it in a header. */
  private csrfTokenCookieOptions() {
    return {
      httpOnly: false,
      secure: this.config.COOKIE_SECURE,
      sameSite: this.config.COOKIE_SAMESITE,
      path: "/",
      maxAge: this.config.SESSION_TTL_SECONDS,
      ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}),
    } as const;
  }

  private clearCookieOptions(httpOnly = true) {
    return {
      httpOnly,
      secure: this.config.COOKIE_SECURE,
      sameSite: this.config.COOKIE_SAMESITE,
      path: "/",
      ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}),
    } as const;
  }
}
