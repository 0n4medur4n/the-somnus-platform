/**
 * WebAuthn settings for the console passkey ceremony (ADR 0027 decision 5).
 *
 * Read when a ceremony runs, never while the process is booting. Identity
 * keeps starting when none of these variables are set.
 *
 * Names follow the service's other env vars (`DATABASE_URL`, `DB_SSL`):
 * `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, and the three optional locks
 * `WEBAUTHN_CHALLENGE_TTL_SECONDS` (only `300`),
 * `WEBAUTHN_PENDING_TTL_SECONDS` (only `86400`) and
 * `WEBAUTHN_MAX_PENDING_CREDENTIALS` (only `3`). The durations are fixed by
 * the ADR, so a different value refuses to operate instead of weakening it.
 */

export const WEBAUTHN_RP_NAME = "The Somnus";
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 300;
export const WEBAUTHN_PENDING_TTL_SECONDS = 24 * 60 * 60;
export const WEBAUTHN_MAX_PENDING_CREDENTIALS = 3;
export const PRODUCTION_WEBAUTHN_ORIGIN = "https://console.thesomnus.com";
export const PRODUCTION_WEBAUTHN_RP_ID = "console.thesomnus.com";

export type WebAuthnConfigProblem =
  | "missing"
  | "origin"
  | "rp_id"
  | "list"
  | "wildcard"
  | "duration";

export class WebAuthnConfigError extends Error {
  constructor(readonly problem: WebAuthnConfigProblem) {
    super("WebAuthn is not configured.");
    this.name = "WebAuthnConfigError";
  }
}

export type WebAuthnConfig = {
  readonly rpId: string;
  readonly rpName: typeof WEBAUTHN_RP_NAME;
  readonly origin: string;
  readonly challengeTtlSeconds: typeof WEBAUTHN_CHALLENGE_TTL_SECONDS;
  readonly pendingTtlSeconds: typeof WEBAUTHN_PENDING_TTL_SECONDS;
  readonly maxPendingCredentials: typeof WEBAUTHN_MAX_PENDING_CREDENTIALS;
};

const LOCAL_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * One local origin, http only, host localhost or 127.0.0.1, optional port
 * 1–65535 with no leading zero. No path, no trailing dot, no list.
 */
function isLocalOrigin(origin: string): boolean {
  const match = /^http:\/\/(localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/.exec(origin);
  if (!match) return false;
  const port = match[2];
  if (port === undefined) return true;
  if (String(Number(port)) !== port) return false;
  const parsed = Number(port);
  return parsed >= 1 && parsed <= 65535;
}

function durationProblem(env: NodeJS.ProcessEnv): boolean {
  const expected: ReadonlyArray<readonly [string, number]> = [
    ["WEBAUTHN_CHALLENGE_TTL_SECONDS", WEBAUTHN_CHALLENGE_TTL_SECONDS],
    ["WEBAUTHN_PENDING_TTL_SECONDS", WEBAUTHN_PENDING_TTL_SECONDS],
    ["WEBAUTHN_MAX_PENDING_CREDENTIALS", WEBAUTHN_MAX_PENDING_CREDENTIALS],
  ];
  for (const [key, value] of expected) {
    const raw = env[key];
    if (raw === undefined || raw === "") continue;
    if (raw !== String(value)) return true;
  }
  return false;
}

/**
 * Production (and anything that is not development or test, including an
 * unset NODE_ENV) accepts exactly one origin and one rpId. Localhost, http,
 * a wildcard, a trailing dot, a port, a path and a list all fail that
 * exact comparison. Development and test may also use a single localhost
 * origin with rpId `localhost`.
 */
export function loadWebAuthnConfig(env: NodeJS.ProcessEnv = process.env): WebAuthnConfig {
  const rpId = env["WEBAUTHN_RP_ID"];
  const origin = env["WEBAUTHN_ORIGIN"];
  if (!rpId || !origin) throw new WebAuthnConfigError("missing");
  if (durationProblem(env)) throw new WebAuthnConfigError("duration");
  if (origin.includes(",") || rpId.includes(",")) throw new WebAuthnConfigError("list");
  if (origin.includes("*") || rpId.includes("*")) throw new WebAuthnConfigError("wildcard");

  const local = LOCAL_ENVIRONMENTS.has(env["NODE_ENV"] ?? "");
  const productionPair =
    origin === PRODUCTION_WEBAUTHN_ORIGIN && rpId === PRODUCTION_WEBAUTHN_RP_ID;
  const localPair = isLocalOrigin(origin) && rpId === "localhost";
  if (productionPair || (local && localPair)) {
    return {
      rpId,
      rpName: WEBAUTHN_RP_NAME,
      origin,
      challengeTtlSeconds: WEBAUTHN_CHALLENGE_TTL_SECONDS,
      pendingTtlSeconds: WEBAUTHN_PENDING_TTL_SECONDS,
      maxPendingCredentials: WEBAUTHN_MAX_PENDING_CREDENTIALS,
    };
  }
  if (local && rpId !== "localhost" && rpId !== PRODUCTION_WEBAUTHN_RP_ID) {
    throw new WebAuthnConfigError("rp_id");
  }
  if (!local && rpId !== PRODUCTION_WEBAUTHN_RP_ID) throw new WebAuthnConfigError("rp_id");
  throw new WebAuthnConfigError("origin");
}
