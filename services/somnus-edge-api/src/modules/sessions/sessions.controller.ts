import { Body, Controller, Delete, Get, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { CsrfTokenResponse, SessionResponse } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { FastifyReply } from "fastify";
import { csrfTokenFor } from "../../bootstrap/csrf-token.js";
import { type EdgeConfig, loadEdgeConfig } from "../../config/edge-config.js";
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";
import { CurrentSession } from "./current-session.decorator.js";
import { SessionCreateDto } from "./session.dto.js";
import { SessionGuard } from "./session.guard.js";
import { type SessionRecord, SessionService } from "./session.service.js";

/**
 * Cookies earlier versions set, cleared on logout so a browser that still holds
 * one does not keep it forever. The API now sets exactly one cookie, the
 * session (see csrf-token.ts for why only one): `somnus_session` was its old
 * name, `_csrf` held @fastify/csrf-protection's secret, and `somnus_csrf` carried
 * the token in a script-readable cookie the SPA could never read cross-site.
 */
const LEGACY_COOKIES = ["somnus_session", "_csrf", "somnus_csrf"] as const;

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

    return {
      firebaseUid: session.firebaseUid,
      email: session.email,
      expiresAt: session.expiresAt.toISOString(),
      csrfToken: this.issueCsrfToken(reply, session.sessionId),
    };
  }

  /**
   * A CSRF token for the current session.
   *
   * The SPA holds the token in memory, so a reload loses it while the session
   * cookie lives on; this is how it gets one back without signing in again.
   * Session-guarded, so it never mints a token for nobody. A GET, so the CSRF
   * gate does not apply -- and does not need to: a cross-site page can make
   * the browser send this request but cannot read the response, because CORS
   * admits only the listed origins.
   */
  @Get("csrf")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Issue a CSRF token for the current session." })
  csrf(
    @CurrentSession() session: SessionRecord | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): CsrfTokenResponse {
    // The guard guarantees a session; this only satisfies the type.
    if (!session) {
      throw new SomnusError(ErrorCode.UNAUTHENTICATED, "Authentication is required.", {
        correlationId: "sessions",
      });
    }
    return { csrfToken: this.issueCsrfToken(reply, session.sessionId) };
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
    for (const name of LEGACY_COOKIES) {
      if (name !== this.config.SESSION_COOKIE_NAME) {
        reply.clearCookie(name, this.clearCookieOptions(name !== "somnus_csrf"));
      }
    }
  }

  /**
   * The session's CSRF token: derived from the session id (csrf-token.ts), so
   * it is the same every time it is asked for during a session and needs no
   * cookie of its own.
   *
   * `no-store`, because a token sitting in a shared or browser cache is a token
   * someone else can read.
   */
  private issueCsrfToken(reply: FastifyReply, sessionId: string): string {
    reply.header("cache-control", "no-store");
    return csrfTokenFor(sessionId, this.config.COOKIE_SECRET);
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
