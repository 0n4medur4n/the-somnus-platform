import type { UUIDv7 } from "@somnus/api-contracts";

/**
 * Passkey rules that do not touch a database (ADR 0027, decision 7).
 * `evaluateSignCount` only classifies a counter. It does not lock,
 * revoke, or write.
 */

export const PASSKEY_CHALLENGE_PURPOSES = ["registration", "authentication", "step_up"] as const;

export type PasskeyChallengePurpose = (typeof PASSKEY_CHALLENGE_PURPOSES)[number];

export type SignCountVerdict = "ok" | "regression";

export type ConsumedPasskeyChallenge = {
  challenge: Buffer;
  purpose: PasskeyChallengePurpose;
  userId: UUIDv7 | null;
  sessionBindingHash: Buffer | null;
};

/**
 * A non-zero received count that is not greater than the stored count is a
 * regression. A received count of zero is ok, including when the stored
 * count is also zero: synced passkeys often report zero forever, and a zero
 * that stays zero does not lock the credential.
 */
export function evaluateSignCount(stored: number, received: number): SignCountVerdict {
  if (received === 0) return "ok";
  if (received > stored) return "ok";
  return "regression";
}

export class PasskeyCredentialIdConflict extends Error {
  constructor() {
    super("A passkey credential with this id already exists.");
    this.name = "PasskeyCredentialIdConflict";
  }
}

export class PasskeyUserNotFound extends Error {
  constructor() {
    super("Passkey operation refused because the user does not exist.");
    this.name = "PasskeyUserNotFound";
  }
}

export class PasskeyChallengeInvalid extends Error {
  constructor() {
    super("A passkey challenge or its session binding must be 32 bytes.");
    this.name = "PasskeyChallengeInvalid";
  }
}

/** Creating a credential without `pending_expires_at` is refused (task 2.2). */
export class PasskeyCredentialExpiryRequired extends Error {
  constructor() {
    super("A passkey credential requires a pending expiry.");
    this.name = "PasskeyCredentialExpiryRequired";
  }
}
