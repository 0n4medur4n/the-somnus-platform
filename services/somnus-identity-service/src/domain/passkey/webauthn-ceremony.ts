import { createHash, timingSafeEqual } from "node:crypto";
import type { PasskeyChallengePurpose } from "./passkey.js";

/**
 * COSE algorithms the console asks for (ADR 0027 decision 5). Passed
 * explicitly to the library: its default list can prepend ML-DSA-44 when
 * the runtime supports post-quantum keys.
 */
export const PASSKEY_COSE_ALGORITHMS = [-7, -8, -257] as const;

/**
 * Reasons a ceremony failed. They appear only on the audit event.
 * The caller of a failed verification receives no reason.
 */
export const PASSKEY_FAILURE_CODES = [
  "challenge_rejected",
  "challenge_expired",
  "challenge_purpose",
  "challenge_user",
  "origin",
  "rp_id",
  "cross_origin",
  "top_origin",
  "user_verification",
  "user_present",
  "client_data",
  "credential_unknown",
  "credential_revoked",
  "credential_locked",
  "credential_duplicate",
  "credential_pending",
  "credential_user",
  "pending_expired",
  "pending_limit",
  "no_active_credential",
  "user_handle",
  "user_missing",
  "account_not_active",
  "firebase_uid_missing",
  "sign_count",
  "counter_race",
  "verification_rejected",
  "algorithm",
] as const;

export type PasskeyFailureCode = (typeof PASSKEY_FAILURE_CODES)[number];

export function isPasskeyFailureCode(value: unknown): value is PasskeyFailureCode {
  return typeof value === "string" && (PASSKEY_FAILURE_CODES as readonly string[]).includes(value);
}

export function isAllowedCoseAlgorithm(algorithm: number): boolean {
  return (PASSKEY_COSE_ALGORITHMS as readonly number[]).includes(algorithm);
}

export type AuthenticatorDataView = {
  rpIdHash: Buffer;
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
  at: boolean;
  signCount: number;
};

export type ParsedClientData =
  | { ok: true; challenge: Buffer; challengeText: string }
  | { ok: false; code: PasskeyFailureCode; challenge: Buffer | null };

/**
 * Reads clientDataJSON ourselves.
 *
 * `@simplewebauthn/server` 14.1.0 does not do this job completely:
 *
 * - `verifyRegistrationResponse` keeps only `type`, `origin`, `challenge`
 *   and `tokenBinding`. It never reads `crossOrigin` or `topOrigin`, so a
 *   registration with `crossOrigin: true` and no `topOrigin` is accepted
 *   when the origin string matches.
 * - `verifyAuthenticationResponse` throws for `crossOrigin: true` only when
 *   `topOrigin` is also present and `expectedTopOrigin` was not passed. If
 *   `crossOrigin` is true and `topOrigin` is absent, it does not throw (the
 *   source says Safari did not support `topOrigin` as of May 2026). A
 *   `topOrigin` with `crossOrigin` false does throw.
 *
 * This function rejects `crossOrigin: true` and any `topOrigin` before the
 * library is called. Origin is compared with `!==`, not a prefix or a URL
 * parser. The library's own origin check (`Array.prototype.includes` on one
 * string) runs afterwards as a second exact comparison.
 */
export function inspectClientData(
  clientDataJSON: Buffer,
  expected: { type: "webauthn.create" | "webauthn.get"; origin: string },
): ParsedClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(clientDataJSON.toString("utf8"));
  } catch {
    return { ok: false, code: "client_data", challenge: null };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: "client_data", challenge: null };
  }
  const record = parsed as Record<string, unknown>;
  if (record["type"] !== expected.type) return { ok: false, code: "client_data", challenge: null };
  if (typeof record["challenge"] !== "string") {
    return { ok: false, code: "client_data", challenge: null };
  }
  const challenge = decodeBase64Url(record["challenge"]);
  if (challenge?.length !== 32) {
    return { ok: false, code: "client_data", challenge: null };
  }
  if (typeof record["origin"] !== "string") {
    return { ok: false, code: "client_data", challenge };
  }
  if (record["origin"] !== expected.origin) return { ok: false, code: "origin", challenge };
  if ("crossOrigin" in record) {
    if (record["crossOrigin"] === true) return { ok: false, code: "cross_origin", challenge };
    if (record["crossOrigin"] !== false) return { ok: false, code: "client_data", challenge };
  }
  if ("topOrigin" in record) return { ok: false, code: "top_origin", challenge };
  return { ok: true, challenge, challengeText: record["challenge"] };
}

/**
 * rpId is not a string in the response. The exact check is SHA-256 of the
 * configured rpId against the first 32 bytes of authenticator data. The
 * library hashes the same single string afterwards (`matchExpectedRPID`).
 */
export function rpIdHashMatches(rpIdHash: Buffer, rpId: string): boolean {
  const expected = createHash("sha256").update(rpId, "utf8").digest();
  if (rpIdHash.length !== expected.length) return false;
  return timingSafeEqual(rpIdHash, expected);
}

export function readAuthenticatorData(authData: Buffer): AuthenticatorDataView | null {
  if (authData.length < 37) return null;
  const flags = authData[32];
  if (flags === undefined) return null;
  return {
    rpIdHash: Buffer.from(authData.subarray(0, 32)),
    up: (flags & 0x01) !== 0,
    uv: (flags & 0x04) !== 0,
    be: (flags & 0x08) !== 0,
    bs: (flags & 0x10) !== 0,
    at: (flags & 0x40) !== 0,
    signCount: authData.readUInt32BE(33),
  };
}

export function authenticatorDataProblem(
  authData: Buffer,
  rpId: string,
): { ok: true; view: AuthenticatorDataView } | { ok: false; code: PasskeyFailureCode } {
  const view = readAuthenticatorData(authData);
  if (!view) return { ok: false, code: "client_data" };
  if (!rpIdHashMatches(view.rpIdHash, rpId)) return { ok: false, code: "rp_id" };
  if (!view.up) return { ok: false, code: "user_present" };
  if (!view.uv) return { ok: false, code: "user_verification" };
  return { ok: true, view };
}

/** Credential id from attested credential data, when the AT flag is set. */
export function attestedCredentialId(authData: Buffer): Buffer | null {
  const view = readAuthenticatorData(authData);
  if (!view?.at || authData.length < 55) return null;
  const credentialLength = authData.readUInt16BE(53);
  const start = 55;
  if (credentialLength < 1 || start + credentialLength > authData.length) return null;
  return Buffer.from(authData.subarray(start, start + credentialLength));
}

/** COSE alg of the credential public key inside attested authenticator data. */
export function attestedCredentialAlgorithm(authData: Buffer): number | null {
  const credentialId = attestedCredentialId(authData);
  if (!credentialId) return null;
  const decoded = readCbor(authData, 55 + credentialId.length);
  if (!decoded || !(decoded.value instanceof Map)) return null;
  const algorithm = decoded.value.get(3);
  if (typeof algorithm !== "number" || !Number.isInteger(algorithm)) return null;
  return algorithm;
}

export function attestedAaguid(authData: Buffer): Buffer | null {
  const view = readAuthenticatorData(authData);
  if (!view?.at || authData.length < 53) return null;
  return Buffer.from(authData.subarray(37, 53));
}

/**
 * Pulls `authData` out of an attestation object without the library, so the
 * registration flags are checked even when `verifyRegistrationResponse`
 * ignores `crossOrigin`.
 */
export function extractAttestedAuthenticatorData(attestationObject: Buffer): Buffer | null {
  const decoded = readCbor(attestationObject, 0);
  if (!decoded || !(decoded.value instanceof Map)) return null;
  const authData = decoded.value.get("authData");
  if (!Buffer.isBuffer(authData) || authData.length < 37) return null;
  return authData;
}

/** COSE key parameter 3, the algorithm. Null when the key is not a map. */
export function coseAlgorithm(publicKey: Buffer): number | null {
  const decoded = readCbor(publicKey, 0);
  if (!decoded || !(decoded.value instanceof Map)) return null;
  const algorithm = decoded.value.get(3);
  if (typeof algorithm !== "number" || !Number.isInteger(algorithm)) return null;
  return algorithm;
}

export function classifyUnconsumedChallenge(
  found: {
    purpose: PasskeyChallengePurpose;
    userId: string | null;
    expiresAt: Date;
  } | null,
  expected: { purpose: PasskeyChallengePurpose; userId: string | null; now: Date },
): PasskeyFailureCode {
  if (!found) return "challenge_rejected";
  if (found.purpose !== expected.purpose) return "challenge_purpose";
  if ((found.userId ?? null) !== (expected.userId ?? null)) return "challenge_user";
  if (found.expiresAt.getTime() <= expected.now.getTime()) return "challenge_expired";
  return "challenge_rejected";
}

export function sameBytes(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0) return null;
  return bytes;
}

type CborValue =
  | number
  | string
  | Buffer
  | boolean
  | null
  | CborValue[]
  | Map<CborValue, CborValue>;

function readCbor(buf: Buffer, offset: number): { value: CborValue; offset: number } | null {
  if (offset >= buf.length) return null;
  const initial = buf[offset];
  if (initial === undefined) return null;
  const major = initial >> 5;
  const additional = initial & 0x1f;
  const argument = readArgument(buf, offset + 1, additional);
  if (!argument) return null;

  if (major === 0) return { value: argument.value, offset: argument.offset };
  if (major === 1) return { value: -1 - argument.value, offset: argument.offset };
  if (major === 2 || major === 3) {
    if (argument.offset + argument.value > buf.length) return null;
    const slice = Buffer.from(buf.subarray(argument.offset, argument.offset + argument.value));
    return {
      value: major === 2 ? slice : slice.toString("utf8"),
      offset: argument.offset + argument.value,
    };
  }
  if (major === 4) {
    const items: CborValue[] = [];
    let cursor = argument.offset;
    for (let index = 0; index < argument.value; index++) {
      const item = readCbor(buf, cursor);
      if (!item) return null;
      items.push(item.value);
      cursor = item.offset;
    }
    return { value: items, offset: cursor };
  }
  if (major === 5) {
    const map = new Map<CborValue, CborValue>();
    let cursor = argument.offset;
    for (let index = 0; index < argument.value; index++) {
      const key = readCbor(buf, cursor);
      if (!key) return null;
      const item = readCbor(buf, key.offset);
      if (!item) return null;
      map.set(key.value, item.value);
      cursor = item.offset;
    }
    return { value: map, offset: cursor };
  }
  if (major === 7 && additional === 20) return { value: false, offset: offset + 1 };
  if (major === 7 && additional === 21) return { value: true, offset: offset + 1 };
  if (major === 7 && additional === 22) return { value: null, offset: offset + 1 };
  return null;
}

function readArgument(
  buf: Buffer,
  offset: number,
  additional: number,
): { value: number; offset: number } | null {
  if (additional < 24) return { value: additional, offset };
  if (additional === 24) {
    const value = buf[offset];
    if (value === undefined) return null;
    return { value, offset: offset + 1 };
  }
  if (additional === 25) {
    if (offset + 2 > buf.length) return null;
    return { value: buf.readUInt16BE(offset), offset: offset + 2 };
  }
  if (additional === 26) {
    if (offset + 4 > buf.length) return null;
    return { value: buf.readUInt32BE(offset), offset: offset + 4 };
  }
  return null;
}
