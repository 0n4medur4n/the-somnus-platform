import { z } from "zod";

/**
 * The only environments in which the session cookie may be weaker than in
 * production: a developer's machine and the test runner. Anything else --
 * `production`, a typo, or no NODE_ENV at all -- is treated as deployed, so a
 * missing setting can never leave a development default in force.
 */
export const LOCAL_ENVIRONMENTS: readonly string[] = ["development", "test"];

/** The fallback that keeps `pnpm dev` runnable with no .env file. Never valid when deployed. */
export const DEVELOPMENT_COOKIE_SECRET = "dev-only-insecure-cookie-secret-change-me";

/** The secret a deployed service needs: at least this many bytes. */
export const MIN_COOKIE_SECRET_BYTES = 32;

/**
 * The console origin when `CONSOLE_ORIGIN` is unset. Missing must not stop
 * the process: development and test may set a local origin, and a deployed
 * service that has not been given the variable still classifies against this.
 */
export const PRODUCTION_CONSOLE_ORIGIN = "https://console.thesomnus.com";

/** Development defaults and placeholders that must never be a deployed secret. */
const KNOWN_DEVELOPMENT_SECRETS: readonly string[] = [
  DEVELOPMENT_COOKIE_SECRET,
  "test-only-cookie-secret-0123456789",
  "unit-test-cookie-secret-0123456789",
];
const PLACEHOLDER_MARKERS = /dev-only|test-only|insecure|change-?me/i;

/**
 * Why `secret` may not sign a deployed service's cookies, or null when it may.
 * The text never contains the secret itself: it goes to the startup log.
 */
export function cookieSecretProblem(secret: string): string | null {
  if (Buffer.byteLength(secret, "utf8") < MIN_COOKIE_SECRET_BYTES) {
    return `is shorter than ${MIN_COOKIE_SECRET_BYTES} bytes`;
  }
  if (KNOWN_DEVELOPMENT_SECRETS.includes(secret) || PLACEHOLDER_MARKERS.test(secret)) {
    return "is a development default or placeholder";
  }
  return null;
}

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
export const EdgeConfigSchema = z
  .object({
    // Firebase Auth: the project whose ID tokens are accepted. May be a
    // comma-separated list while Authentication moves between projects; a token
    // is verified only by the project its own `aud` names (firebase.service.ts).
    FIREBASE_PROJECT_ID: z.string().min(1).default("somnus-dev"),
    // The project whose Firestore holds server-side sessions. SEPARATE from
    // FIREBASE_PROJECT_ID on purpose: Auth lives in the Firebase project, the
    // sessions database lives in the platform's own project. It deliberately does
    // not fall back to FIREBASE_PROJECT_ID -- that coupling is what pointed every
    // session write at a project with no Firestore database in it.
    FIRESTORE_PROJECT_ID: z.string().min(1).default("somnus-dev"),
    // When set, firebase-admin talks to the local Auth emulator instead
    // of real Firebase (host:port, e.g. "127.0.0.1:4400"). firebase-admin
    // reads this env var itself; we surface it here only to validate it.
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
    // When set, the Firestore client talks to the local Firestore
    // emulator (host:port). Read directly by firebase-admin/@google-cloud.
    FIRESTORE_EMULATOR_HOST: z.string().optional(),

    // Session cookie
    // `__session` because Firebase Hosting, which fronts this API at
    // api.thesomnus.com, forwards no other cookie to Cloud Run.
    SESSION_COOKIE_NAME: z.string().min(1).default("__session"),
    // The deployment environment (set to "production" by Terraform). Only
    // "development" and "test" count as local: see LOCAL_ENVIRONMENTS.
    NODE_ENV: z.string().optional(),
    // Signs the session cookie and derives the CSRF token. Required whenever the
    // service is not local: at least 32 bytes, and never a development default
    // (the checks below). Locally a fixed fallback keeps `pnpm dev` runnable.
    COOKIE_SECRET: z.string().min(1).optional(),
    // During a rotation: the secret being retired. Cookies signed with it are still
    // accepted; nothing is signed with it. Remove it once the old cookies have
    // expired (SESSION_TTL_SECONDS, at most 14 days).
    COOKIE_SECRET_PREVIOUS: z.string().min(1).optional(),
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
    // Compared to the request Origin with string equality (classify-session.ts).
    // Not parsed as a URL, so a port, a trailing dot or different case stays
    // different. Unset uses the production origin; an empty value is refused.
    CONSOLE_ORIGIN: z.string().min(1).default(PRODUCTION_CONSOLE_ORIGIN),

    // CORS: the Firebase Hosting origins (build plan §5.3, extended in Addendum A
    // §A2.1 with the admin console's own site). Comma-separated. The local
    // defaults cover somnus-app (5173 dev / 4173 preview) and somnus-admin
    // (5174 / 4174), so `pnpm dev` works for both with no .env file.
    CORS_ORIGINS: z
      .string()
      .default(
        "http://localhost:5173,http://localhost:4173,http://localhost:5174,http://localhost:4174",
      )
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
    // The private morpheo service (build plan §5.5 / §20 Checkpoint 10.3).
    // edge-api proxies the anonymous assessment flow to it over HTTP with an
    // OIDC identity token; there is no morpheo database connection here.
    MORPHEO_BASE_URL: z.string().url().default("http://127.0.0.1:8080"),
    // OIDC audience for morpheo's Cloud Run URL; defaults to MORPHEO_BASE_URL.
    MORPHEO_AUDIENCE: z.string().min(1).optional(),
    // The private report service (build plan §5.6 / §20 Checkpoint 11.1). edge-api
    // renders reports through it and returns the short-lived signed URLs (§9).
    REPORT_BASE_URL: z.string().url().default("http://127.0.0.1:8081"),
    // OIDC audience for the report service's Cloud Run URL; defaults to REPORT_BASE_URL.
    REPORT_AUDIENCE: z.string().min(1).optional(),

    // The worker owns `somnus_audit` (build plan §5.7 / ADR 0010), so the admin
    // console's statistics and audit viewer reach it through here -- never through
    // a second connection to that database.
    WORKER_BASE_URL: z.string().url().default("http://127.0.0.1:3003"),
    // OIDC audience for the worker's Cloud Run URL; defaults to WORKER_BASE_URL.
    WORKER_AUDIENCE: z.string().min(1).optional(),
    // Notification tasks go through this Cloud Tasks queue (build plan §5.7: the
    // Notification module is a Cloud Tasks consumer), so the caller is answered
    // as soon as the task is queued and the worker sends it in the background.
    // Unset (local dev, tests): the task is posted to the worker directly.
    NOTIFICATIONS_QUEUE: z
      .string()
      .regex(/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[A-Za-z0-9-]+$/)
      .optional(),
    // The identity Cloud Tasks presents to the worker (an OIDC token for this
    // service account, which holds run.invoker on the worker). Required with a queue.
    NOTIFICATIONS_TASK_INVOKER: z.string().email().optional(),
    // Private Cloud Storage bucket for profile photos (build plan §388). Unset in
    // local dev and tests, where photos live in memory; a production process with
    // it unset refuses photo uploads rather than keeping them in memory.
    PROFILE_PHOTOS_BUCKET: z.string().min(3).max(63).optional(),
    // Where a sign-in link lands: the app's callback route. The emailed link points
    // here directly (not at Firebase's handler), with only the one-time code.
    SIGN_IN_CALLBACK_URL: z.string().url().default("http://localhost:5173/auth/callback"),
    // The admin console's own callback, for staff signing in to the console.
    SIGN_IN_CONSOLE_CALLBACK_URL: z.string().url().default("http://localhost:5174/auth/callback"),
    // How internal calls are authenticated. `gcp`: mint a real Google
    // OIDC identity token (production on Cloud Run). `insecure-dev`: send
    // a fixed dev token -- for local/docker/tests where there is no GCP
    // metadata server and identity is not behind Cloud Run IAM.
    INTERNAL_AUTH_MODE: z.enum(["gcp", "insecure-dev"]).default("insecure-dev"),
    // Per-call timeout for internal composition requests (ms).
    INTERNAL_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
  })
  .superRefine((config, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    const local = LOCAL_ENVIRONMENTS.includes(config.NODE_ENV ?? "");
    if (local) {
      // A local secret may be short, but not absurdly so.
      for (const key of ["COOKIE_SECRET", "COOKIE_SECRET_PREVIOUS"] as const) {
        const value = config[key];
        if (value !== undefined && value.length < 16) issue(key, "must be at least 16 characters");
      }
      return;
    }

    // Deployed: fail closed. Every rule below is a refusal to start, so a
    // misconfigured service never serves a single request with a weak cookie.
    if (config.COOKIE_SECRET === undefined) {
      issue(
        "COOKIE_SECRET",
        "is required unless NODE_ENV is development or test (the development default is never used when deployed)",
      );
    } else {
      const problem = cookieSecretProblem(config.COOKIE_SECRET);
      if (problem) issue("COOKIE_SECRET", problem);
    }
    if (config.COOKIE_SECRET_PREVIOUS !== undefined) {
      const problem = cookieSecretProblem(config.COOKIE_SECRET_PREVIOUS);
      if (problem) issue("COOKIE_SECRET_PREVIOUS", problem);
      if (config.COOKIE_SECRET_PREVIOUS === config.COOKIE_SECRET) {
        issue("COOKIE_SECRET_PREVIOUS", "must differ from COOKIE_SECRET");
      }
    }
    if (!config.COOKIE_SECURE) {
      issue("COOKIE_SECURE", "must be true unless NODE_ENV is development or test");
    }
    if (config.COOKIE_DOMAIN !== undefined) {
      issue("COOKIE_DOMAIN", "must not be set: the session cookie is host-only, without a Domain");
    }
    if (config.COOKIE_SAMESITE === "none") {
      issue("COOKIE_SAMESITE", "must be lax or strict unless NODE_ENV is development or test");
    }
  })
  .transform((config) => {
    const current = config.COOKIE_SECRET ?? DEVELOPMENT_COOKIE_SECRET;
    return {
      ...config,
      COOKIE_SECRET: current,
      /** Every secret a signature may verify against: the one in use, then the retired one. */
      COOKIE_SECRETS: config.COOKIE_SECRET_PREVIOUS
        ? [current, config.COOKIE_SECRET_PREVIOUS]
        : [current],
    };
  });

export type EdgeConfig = z.infer<typeof EdgeConfigSchema>;

export function loadEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  const result = EdgeConfigSchema.safeParse(env);
  if (!result.success) {
    // Paths and messages only, never the offending values: they may be secrets.
    const lines = result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    console.error(`[edge-config] FATAL: invalid edge configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  return result.data;
}
