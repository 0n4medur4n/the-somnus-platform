import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  type ConsumedPasskeyChallenge,
  PasskeyChallengeInvalid,
  type PasskeyChallengePurpose,
} from "../../../domain/passkey/passkey.js";
import type { Db } from "../db.client.js";
import { passkeyChallenges } from "../schema/index.js";
import { assertPasskeyUser } from "./passkey-user.js";

/**
 * How many already-expired challenges one `create` may delete.
 * The sweep is the only cleanup (ADR 0027 decision 6): no scheduler.
 */
export const PASSKEY_CHALLENGE_CLEANUP_LIMIT = 100;

export type NewPasskeyChallenge = {
  challenge: Buffer;
  purpose: PasskeyChallengePurpose;
  userId: UUIDv7 | null;
  sessionBindingHash: Buffer | null;
  expiresAt: Date;
};

export type PasskeyChallengeBinding = {
  purpose: PasskeyChallengePurpose;
  userId: UUIDv7 | null;
  expiresAt: Date;
};

export interface PasskeyChallengeStore {
  create(input: NewPasskeyChallenge): Promise<UUIDv7>;
  consume(
    challenge: Buffer,
    purpose: PasskeyChallengePurpose,
    userId?: UUIDv7,
    sessionBindingHash?: Buffer,
  ): Promise<ConsumedPasskeyChallenge | null>;
  findBinding(challenge: Buffer): Promise<PasskeyChallengeBinding | null>;
}

/**
 * MySQL store for single-use passkey challenges. Consumption is one
 * conditional DELETE. There is no "mark used" update.
 */
export class PasskeyChallengesRepository implements PasskeyChallengeStore {
  constructor(private readonly db: Db) {}

  /**
   * Deliberately NOT user-scoped: the call deletes already-expired
   * challenges for every user, bounded, and a usernameless challenge
   * has no user. When `userId` is set, the user must exist.
   */
  async create(input: NewPasskeyChallenge): Promise<UUIDv7> {
    if (
      input.challenge.length !== 32 ||
      (input.sessionBindingHash !== null && input.sessionBindingHash.length !== 32)
    ) {
      throw new PasskeyChallengeInvalid();
    }
    if (input.userId !== null) await assertPasskeyUser(this.db, input.userId);

    await this.db
      .delete(passkeyChallenges)
      .where(lt(passkeyChallenges.expiresAt, new Date()))
      .limit(PASSKEY_CHALLENGE_CLEANUP_LIMIT);

    const id = UUIDv7();
    await this.db.insert(passkeyChallenges).values({
      id,
      challenge: input.challenge,
      purpose: input.purpose,
      userId: input.userId,
      sessionBindingHash: input.sessionBindingHash,
      expiresAt: input.expiresAt,
    });
    return id;
  }

  /**
   * Deliberately NOT user-scoped: the challenge bytes are the
   * unguessable key. `userId` and `sessionBindingHash`, when omitted,
   * match only a null column, so a challenge bound to a user or a
   * session cannot be consumed by leaving that argument out. One
   * conditional DELETE; affected rows must be exactly 1. MySQL's
   * DELETE does not return the row, and the match is fully determined
   * by these predicates, so the record returned is that match.
   */
  async consume(
    challenge: Buffer,
    purpose: PasskeyChallengePurpose,
    userId?: UUIDv7,
    sessionBindingHash?: Buffer,
  ): Promise<ConsumedPasskeyChallenge | null> {
    const deleted = await this.db
      .delete(passkeyChallenges)
      .where(
        and(
          eq(passkeyChallenges.challenge, challenge),
          eq(passkeyChallenges.purpose, purpose),
          gt(passkeyChallenges.expiresAt, new Date()),
          userId === undefined
            ? isNull(passkeyChallenges.userId)
            : eq(passkeyChallenges.userId, userId),
          sessionBindingHash === undefined
            ? isNull(passkeyChallenges.sessionBindingHash)
            : eq(passkeyChallenges.sessionBindingHash, sessionBindingHash),
        ),
      );
    if ((deleted[0].affectedRows ?? 0) !== 1) return null;
    return {
      challenge,
      purpose,
      userId: userId ?? null,
      sessionBindingHash: sessionBindingHash ?? null,
    };
  }

  /**
   * Deliberately NOT user-scoped: used only after `consume` matched
   * nothing, to classify the audit code. The challenge bytes are the
   * key the caller already holds. This returns no challenge bytes.
   */
  async findBinding(challenge: Buffer): Promise<PasskeyChallengeBinding | null> {
    const rows = await this.db
      .select({
        purpose: passkeyChallenges.purpose,
        userId: passkeyChallenges.userId,
        expiresAt: passkeyChallenges.expiresAt,
      })
      .from(passkeyChallenges)
      .where(eq(passkeyChallenges.challenge, challenge))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { purpose: row.purpose, userId: row.userId, expiresAt: row.expiresAt };
  }
}
