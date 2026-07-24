import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrf from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { EdgeConfig } from "../config/edge-config.js";

/** Methods that mutate state and therefore require CSRF protection. */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes exempt from CSRF because they establish the session rather
 * than ride it. `POST /v1/sessions` is the login bootstrap -- it has
 * no session cookie yet to be forged against, and is instead protected
 * by requiring a valid Firebase ID token. Every other state-changing
 * route rides the session cookie and MUST be CSRF-protected.
 */
const CSRF_EXEMPT = new Set(["/v1/sessions"]);

/**
 * Applies build plan §21's security baseline to the Fastify instance:
 * helmet, strict CORS for the two Hosting origins, signed cookies,
 * rate limiting, request-size limits (set on the adapter, see main.ts),
 * and CSRF on state-changing routes. Extracted so production
 * (main.ts) and the tests apply exactly the same hardening -- a
 * negative test for CSRF/rate-limit/cookie attributes is only
 * meaningful if the app under test is hardened identically to prod.
 */
export async function applyHardening(
  app: NestFastifyApplication,
  config: EdgeConfig,
): Promise<void> {
  await app.register(helmet, { contentSecurityPolicy: false });

  // Cookies must be registered before csrf-protection (which stores its
  // secret in a signed cookie). The secret signs the session cookie too.
  await app.register(cookie, { secret: config.COOKIE_SECRET });

  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-correlation-id", "x-csrf-token"],
  });

  // The plugin's over-limit error carries statusCode 429; the shared
  // SomnusExceptionFilter maps that to the §16 RATE_LIMITED shape (see
  // common/filters/somnus-exception.filter.ts), so no custom
  // errorResponseBuilder is needed here.
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
  });

  // The SPA echoes the CSRF token in the x-csrf-token header (the token
  // is delivered via the readable somnus_csrf cookie on login).
  await app.register(csrf, {
    getToken: (req: FastifyRequest) => {
      const header = req.headers["x-csrf-token"];
      return Array.isArray(header) ? header[0] : header;
    },
    cookieOpts: {
      signed: true,
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      path: "/",
    },
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("preHandler", (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const path = req.url.split("?")[0] ?? req.url;
    if (STATE_CHANGING.has(req.method) && !CSRF_EXEMPT.has(path)) {
      fastify.csrfProtection(req, reply, done);
      return;
    }
    done();
  });
}
