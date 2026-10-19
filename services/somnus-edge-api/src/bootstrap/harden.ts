import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  CORPUS_FILE_CONTENT_TYPES,
  CORPUS_FILE_MAX_BYTES,
  DRIVE_BLOCK_MAX_BYTES,
} from "@somnus/api-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EdgeConfig } from "../config/edge-config.js";
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES } from "../modules/me/profile-photo.js";
import { markCsrfCheckPassed, markCsrfCheckPending } from "./csrf-state.js";
import { csrfTokenMatches } from "./csrf-token.js";

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
 * CSRF applies to state-changing routes that ride the authenticated session
 * cookie. The anonymous assessment routes (create, submit answer, mint a
 * claim token) carry no such cookie — exactly the `POST /v1/sessions`
 * rationale — so a forged cross-site request gains nothing. The authenticated
 * claim (`/v1/assessments/claim`) DOES ride the session cookie and stays
 * protected.
 *
 * The v2 interview (`/v1/funnel`) is anonymous in the same way (the person
 * may be signed in or not, and nothing in it rides a session to act on the
 * person's behalf): start it, answer a step, go back, rewind to correct. Every
 * route is a POST on the interview's own id, which is unguessable; the owner's
 * PDF is a GET and mutates nothing.
 *
 * `/v1/invitations/preview` is exempt for the same reason: it is the pre-login
 * lookup behind the invitation accept screen (Addendum A Checkpoint 14.2), so
 * by definition there is no session cookie yet to forge against. It reads; it
 * creates nothing. `/v1/invitations/accept` rides the session and stays
 * protected.
 */
const FUNNEL_ANONYMOUS_POST = /^\/v1\/funnel\/sessions(?:\/[^/]+\/(?:answers|back|rewind))?$/;

export function isCsrfExempt(path: string): boolean {
  if (CSRF_EXEMPT.has(path)) return true;
  if (path === "/v1/invitations/preview") return true;
  // Asking for a sign-in link happens before any session exists -- nothing to
  // forge against. It is rate-limited per IP and per address instead.
  if (path === "/v1/auth/email-link") return true;
  if (FUNNEL_ANONYMOUS_POST.test(path)) return true;
  if (path === "/v1/assessments") return true;
  return path.startsWith("/v1/assessments/") && path !== "/v1/assessments/claim";
}

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

  // Signs the session cookie. The CSRF token is derived from the same secret
  // (through a label-specific key, see csrf-token.ts), so there is no second
  // cookie to register.
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

  const fastify = app.getHttpAdapter().getInstance();

  registerRawBodyParsers(fastify);

  // Every API answer is about one person and one moment, so nothing may keep
  // it unless the route says otherwise (the profile photo sets its own policy).
  // Without this, Firebase Hosting gives a response that carries no
  // Cache-Control a default of its own -- `max-age=600` on a 404 -- and the
  // browser then replays the pre-registration "no account yet" 404 of
  // `/v1/me` for ten minutes, so a person who has just registered is shown
  // the registration form again (2026-10-15).
  fastify.addHook("onSend", (_req, reply, payload, done) => {
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    done(null, payload);
  });

  fastify.addHook("preHandler", (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const path = req.url.split("?")[0] ?? req.url;
    if (STATE_CHANGING.has(req.method) && !isCsrfExempt(path)) {
      // The pending mark is how the exception filter knows which 403s were
      // CSRF rejections (see csrf-state.ts). It is cleared only when the token
      // verifies.
      markCsrfCheckPending(req);
      if (csrfTokenMatches(sessionIdOf(req, config), config.COOKIE_SECRET, csrfHeaderOf(req))) {
        markCsrfCheckPassed(req);
        done();
        return;
      }
      reply.send(Object.assign(new Error("CSRF token missing or invalid"), { statusCode: 403 }));
      return;
    }
    done();
  });
}

/**
 * The raw bodies edge-api accepts, each with its own ceiling instead of the
 * global JSON limit. Every other content type is still a 415.
 *
 * - The profile photo upload (PUT /v1/me/photo): the two image types, 1 MB.
 * - The staff Drive's file blocks (ADR 0019): ciphertext, one 512 KiB block
 *   plus AES-GCM overhead. Only the Drive's block route reads it; anywhere
 *   else these bytes fail the route's own validation, exactly as an image does
 *   outside the photo route.
 * - Reference-corpus originals (owner decision 2026-10-18): PDF and Word, up to
 *   20 MB, read only by the corpus upload route behind admin_corpus_manage.
 *
 * Exported so a test app that does not apply the full hardening (the admin
 * gate suite, which has no CSRF) still parses bodies exactly as production does.
 */
export function registerRawBodyParsers(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    [...PROFILE_PHOTO_TYPES],
    { parseAs: "buffer", bodyLimit: PROFILE_PHOTO_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  fastify.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: DRIVE_BLOCK_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  fastify.addContentTypeParser(
    [...CORPUS_FILE_CONTENT_TYPES],
    { parseAs: "buffer", bodyLimit: CORPUS_FILE_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
}

/**
 * The session id from the signed session cookie, or "" when there is none or
 * its signature does not verify. `csrfTokenMatches` refuses "" outright, so a
 * missing or forged cookie gets no further than here.
 *
 * The SPA's JavaScript never reads this cookie (HttpOnly). It is the only
 * cookie the API sets, because Firebase Hosting forwards only `__session` to
 * Cloud Run (see csrf-token.ts).
 */
function sessionIdOf(req: FastifyRequest, config: EdgeConfig): string {
  const raw = req.cookies[config.SESSION_COOKIE_NAME];
  if (!raw) return "";
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value !== null ? unsigned.value : "";
}

/** The `x-csrf-token` header; the first value if the client sent several. */
function csrfHeaderOf(req: FastifyRequest): string | undefined {
  const header = req.headers["x-csrf-token"];
  return Array.isArray(header) ? header[0] : header;
}
