import { z } from "zod";

/**
 * Edge-API-specific configuration, validated at startup (same
 * fail-fast pattern as identity's db.config.ts). Kept separate from
 * `@somnus/config`'s shared SomnusConfigSchema: these fields are
 * edge-api's alone.
 *
 * Cookie security attributes are environment-driven, not hardcoded:
 * build plan §21 requires Secure/HttpOnly/SameSite cookies in
 * production, but local dev and the docker-compose stack run over
 * plain HTTP where a `Secure` cookie would never be sent back. So
 * `COOKIE_SECURE` defaults to false and is set true in every deployed
 * environment.
 */
export const EdgeConfigSchema = z.object({
  // Firebase
  FIREBASE_PROJECT_ID: z.string().min(1).default("somnus-dev"),
  // When set, firebase-admin talks to the local Auth emulator instead
  // of real Firebase (host:port, e.g. "127.0.0.1:4400"). firebase-admin
  // reads this env var itself; we surface it here only to validate it.
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  // When set, the Firestore client talks to the local Firestore
  // emulator (host:port). Read directly by firebase-admin/@google-cloud.
  FIRESTORE_EMULATOR_HOST: z.string().optional(),

  // Session cookie
  SESSION_COOKIE_NAME: z.string().min(1).default("somnus_session"),
  // Signs the session and CSRF cookies (@fastify/cookie). Required in
  // production; a fixed dev-only fallback keeps local/test runnable.
  COOKIE_SECRET: z.string().min(16).default("dev-only-insecure-cookie-secret-change-me"),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 14)
    .default(60 * 60 * 24 * 7),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional(),

  // CORS: the two Firebase Hosting origins (build plan §5.3). Comma-separated.
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:4173")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),

  // Rate limiting (build plan §21). Applies globally.
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

  // Request-size limit (build plan §21). Session exchange bodies are tiny.
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(64 * 1024),

  // Internal composition target: the private identity service (build
  // plan §5.3 / §20 Checkpoint 8.2). edge-api reaches it over HTTP with
  // an OIDC identity token; there is no database connection here.
  IDENTITY_BASE_URL: z.string().url().default("http://127.0.0.1:3001"),
  // The OIDC audience for identity's Cloud Run URL. In `gcp` auth mode a
  // Google-signed identity token with this audience is minted per call;
  // Cloud Run IAM verifies it. Defaults to IDENTITY_BASE_URL when unset.
  IDENTITY_AUDIENCE: z.string().min(1).optional(),
  // How internal calls are authenticated. `gcp`: mint a real Google
  // OIDC identity token (production on Cloud Run). `insecure-dev`: send
  // a fixed dev token -- for local/docker/tests where there is no GCP
  // metadata server and identity is not behind Cloud Run IAM.
  INTERNAL_AUTH_MODE: z.enum(["gcp", "insecure-dev"]).default("insecure-dev"),
  // Per-call timeout for internal composition requests (ms).
  INTERNAL_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
});

export type EdgeConfig = z.infer<typeof EdgeConfigSchema>;

export function loadEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  const result = EdgeConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[edge-config] FATAL: invalid edge configuration:\n${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
