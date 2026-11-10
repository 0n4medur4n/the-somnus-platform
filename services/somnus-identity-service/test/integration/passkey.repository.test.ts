import { UUIDv7 } from "@somnus/api-contracts";
import { count, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PasskeyChallengeInvalid,
  PasskeyCredentialIdConflict,
  PasskeyUserNotFound,
} from "../../src/domain/passkey/passkey.js";
import { AccountDeletionRepository } from "../../src/infrastructure/db/repositories/account-deletion.repository.js";
import {
  PASSKEY_CHALLENGE_CLEANUP_LIMIT,
  PasskeyChallengesRepository,
} from "../../src/infrastructure/db/repositories/passkey-challenges.repository.js";
import {
  PASSKEY_PENDING_CLEANUP_LIMIT,
  PasskeyCredentialsRepository,
} from "../../src/infrastructure/db/repositories/passkey-credentials.repository.js";
import { PasskeyUserHandlesRepository } from "../../src/infrastructure/db/repositories/passkey-user-handles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import {
  passkeyChallenges,
  passkeyCredentials,
  passkeyUserHandles,
} from "../../src/infrastructure/db/schema/index.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

const past = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

function bytes(length: number, seed: number): Buffer {
  const buffer = Buffer.alloc(length);
  for (let i = 0; i < length; i++) buffer[i] = (seed + i) & 0xff;
  return buffer;
}

describe("passkey data model (ADR 0027, task 2.1)", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const credentials = new PasskeyCredentialsRepository(db);
  const challenges = new PasskeyChallengesRepository(db);
  const handles = new PasskeyUserHandlesRepository(db);
  const erasure = new AccountDeletionRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  async function user(email: string) {
    return users.create({ email });
  }

  async function pendingCredential(userId: string, seed: number, pendingExpiresAt: Date | null) {
    const credentialId = bytes(32, seed);
    credentialId[0] = 0x00;
    credentialId[1] = 0xff;
    const id = await credentials.create({
      userId: userId as ReturnType<typeof UUIDv7>,
      credentialId,
      publicKey: bytes(64, seed + 3),
      coseAlgorithm: -7,
      transports: ["internal", "hybrid"],
      aaguid: bytes(16, seed + 9),
      backupEligible: true,
      backupState: false,
      name: "Portátil",
      pendingExpiresAt,
    });
    return { id, credentialId };
  }

  describe("challenges", () => {
    it("lets exactly one of two concurrent consume calls succeed", async () => {
      const challenge = bytes(32, 1);
      await db.insert(passkeyChallenges).values({
        id: UUIDv7(),
        challenge,
        purpose: "authentication",
        userId: null,
        sessionBindingHash: null,
        expiresAt: future(),
      });

      const results = await Promise.all([
        challenges.consume(challenge, "authentication"),
        challenges.consume(challenge, "authentication"),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      const winner = results.find((result) => result !== null);
      expect(winner?.purpose).toBe("authentication");
      expect(winner?.userId).toBeNull();
      expect(winner?.sessionBindingHash).toBeNull();
      expect(winner?.challenge.equals(challenge)).toBe(true);
      const left = await db
        .select()
        .from(passkeyChallenges)
        .where(eq(passkeyChallenges.challenge, challenge));
      expect(left).toHaveLength(0);
    });

    it("returns null and deletes nothing when the challenge is expired, or the purpose, user or binding is wrong", async () => {
      const owner = await user("owner@example.com");
      const challenge = bytes(32, 2);
      const binding = bytes(32, 3);
      await db.insert(passkeyChallenges).values({
        id: UUIDv7(),
        challenge,
        purpose: "registration",
        userId: owner,
        sessionBindingHash: binding,
        expiresAt: future(),
      });

      expect(await challenges.consume(challenge, "authentication", owner, binding)).toBeNull();
      expect(await challenges.consume(challenge, "registration", UUIDv7(), binding)).toBeNull();
      expect(await challenges.consume(challenge, "registration", owner, bytes(32, 4))).toBeNull();
      expect(await challenges.consume(challenge, "registration", owner)).toBeNull();
      expect(await challenges.consume(challenge, "registration")).toBeNull();

      const expired = bytes(32, 5);
      await db.insert(passkeyChallenges).values({
        id: UUIDv7(),
        challenge: expired,
        purpose: "step_up",
        userId: null,
        sessionBindingHash: null,
        expiresAt: past(),
      });
      expect(await challenges.consume(expired, "step_up")).toBeNull();

      const remaining = await db.select({ id: passkeyChallenges.id }).from(passkeyChallenges);
      expect(remaining).toHaveLength(2);
    });

    it("deletes only expired rows, and no more than the cleanup limit, when creating a challenge", async () => {
      const expiredRows = Array.from({ length: PASSKEY_CHALLENGE_CLEANUP_LIMIT + 1 }, (_, i) => ({
        id: UUIDv7(),
        challenge: bytes(32, 20 + i),
        purpose: "authentication" as const,
        userId: null,
        sessionBindingHash: null,
        expiresAt: past(),
      }));
      const kept = bytes(32, 19);
      await db.insert(passkeyChallenges).values([
        ...expiredRows,
        {
          id: UUIDv7(),
          challenge: kept,
          purpose: "authentication",
          userId: null,
          sessionBindingHash: null,
          expiresAt: future(),
        },
      ]);

      await challenges.create({
        challenge: bytes(32, 18),
        purpose: "registration",
        userId: null,
        sessionBindingHash: null,
        expiresAt: future(),
      });

      const rows = await db
        .select({ expiresAt: passkeyChallenges.expiresAt })
        .from(passkeyChallenges);
      const expiredLeft = rows.filter((row) => row.expiresAt.getTime() < Date.now());
      expect(expiredLeft).toHaveLength(1);
      expect(rows).toHaveLength(3);
      const keptRow = await db
        .select()
        .from(passkeyChallenges)
        .where(eq(passkeyChallenges.challenge, kept));
      expect(keptRow).toHaveLength(1);
    });

    it("refuses a challenge that is not 32 bytes, or a user that does not exist, and then deletes nothing", async () => {
      await db.insert(passkeyChallenges).values({
        id: UUIDv7(),
        challenge: bytes(32, 6),
        purpose: "authentication",
        userId: null,
        sessionBindingHash: null,
        expiresAt: past(),
      });

      await expect(
        challenges.create({
          challenge: bytes(31, 7),
          purpose: "authentication",
          userId: null,
          sessionBindingHash: null,
          expiresAt: future(),
        }),
      ).rejects.toBeInstanceOf(PasskeyChallengeInvalid);
      await expect(
        challenges.create({
          challenge: bytes(32, 8),
          purpose: "authentication",
          userId: null,
          sessionBindingHash: bytes(16, 9),
          expiresAt: future(),
        }),
      ).rejects.toBeInstanceOf(PasskeyChallengeInvalid);
      await expect(
        challenges.create({
          challenge: bytes(32, 10),
          purpose: "authentication",
          userId: UUIDv7(),
          sessionBindingHash: null,
          expiresAt: future(),
        }),
      ).rejects.toBeInstanceOf(PasskeyUserNotFound);

      const rows = await db.select({ id: passkeyChallenges.id }).from(passkeyChallenges);
      expect(rows).toHaveLength(1);
    });
  });

  describe("credentials", () => {
    it("rejects a second insert of the same credential id", async () => {
      const first = await user("first@example.com");
      const second = await user("second@example.com");
      const { credentialId } = await pendingCredential(first, 30, future());

      await expect(pendingCredential(second, 30, future())).rejects.toBeInstanceOf(
        PasskeyCredentialIdConflict,
      );
      const rows = await db
        .select()
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.credentialId, credentialId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(first);
    });

    it("activates only a pending credential, is idempotent, and never reactivates a revoked or locked one", async () => {
      const owner = await user("activate@example.com");
      const other = await user("other@example.com");
      const now = new Date();
      const { credentialId } = await pendingCredential(owner, 40, future());

      expect(await credentials.activate({ userId: other }, credentialId, now)).toBe(false);
      expect(await credentials.activate({ userId: owner }, credentialId, now)).toBe(true);
      const activated = await credentials.findByCredentialId(credentialId);
      expect(activated?.activatedAt).not.toBeNull();
      expect(activated?.lastUsedAt).not.toBeNull();
      expect(activated?.credentialId.equals(credentialId)).toBe(true);
      expect(activated?.publicKey.equals(bytes(64, 43))).toBe(true);
      expect(activated?.transports).toEqual(["internal", "hybrid"]);
      expect(activated?.backupEligible).toBe(true);
      expect(activated?.backupState).toBe(false);
      expect(activated?.name).toBe("Portátil");

      expect(await credentials.activate({ userId: owner }, credentialId, future())).toBe(true);
      const again = await credentials.findByCredentialId(credentialId);
      expect(again?.activatedAt).toEqual(activated?.activatedAt);
      expect(again?.lastUsedAt).toEqual(activated?.lastUsedAt);

      const revokedAt = future();
      expect(await credentials.revoke({ userId: owner }, credentialId, revokedAt)).toBe(true);
      expect(await credentials.activate({ userId: owner }, credentialId, future())).toBe(false);
      const revoked = await credentials.findByCredentialId(credentialId);
      expect(revoked?.revokedAt).not.toBeNull();
      expect(revoked?.activatedAt).toEqual(activated?.activatedAt);

      const locked = await pendingCredential(owner, 41, null);
      const lockedAt = now;
      expect(await credentials.activate({ userId: owner }, locked.credentialId, now)).toBe(true);
      expect(await credentials.lock({ userId: owner }, locked.credentialId, lockedAt)).toBe(true);
      expect(await credentials.lock({ userId: owner }, locked.credentialId, future())).toBe(false);
      expect(await credentials.activate({ userId: owner }, locked.credentialId, future())).toBe(
        false,
      );
      const lockedRow = await credentials.findByCredentialId(locked.credentialId);
      expect(lockedRow?.lockedAt).not.toBeNull();

      const revokedPending = await pendingCredential(owner, 42, future());
      expect(await credentials.revoke({ userId: owner }, revokedPending.credentialId, now)).toBe(
        true,
      );
      expect(
        await credentials.activate({ userId: owner }, revokedPending.credentialId, future()),
      ).toBe(false);
      expect(
        (await credentials.findByCredentialId(revokedPending.credentialId))?.activatedAt,
      ).toBeNull();

      const expiredPending = await pendingCredential(owner, 43, past());
      expect(await credentials.activate({ userId: owner }, expiredPending.credentialId, now)).toBe(
        false,
      );
      expect(
        (await credentials.findByCredentialId(expiredPending.credentialId))?.activatedAt,
      ).toBeNull();
    });

    it("does not count revoked, locked or pending credentials as active", async () => {
      const owner = await user("count@example.com");
      const other = await user("count-other@example.com");
      const now = new Date();
      const active = await pendingCredential(owner, 50, future());
      const pending = await pendingCredential(owner, 51, future());
      const revoked = await pendingCredential(owner, 52, future());
      const locked = await pendingCredential(owner, 53, future());
      const someoneElse = await pendingCredential(other, 54, future());
      await credentials.activate({ userId: owner }, active.credentialId, now);
      await credentials.activate({ userId: owner }, revoked.credentialId, now);
      await credentials.activate({ userId: owner }, locked.credentialId, now);
      await credentials.activate({ userId: other }, someoneElse.credentialId, now);
      await credentials.revoke({ userId: owner }, revoked.credentialId, now);
      await credentials.lock({ userId: owner }, locked.credentialId, now);

      expect(await credentials.countActiveByUser({ userId: owner })).toBe(1);
      expect(await credentials.countActiveByUser({ userId: other })).toBe(1);
      const listed = await credentials.listByUser({ userId: owner });
      expect(listed.map((row) => row.id).sort()).toEqual(
        [active.id, pending.id, revoked.id, locked.id].sort(),
      );
    });

    it("revokeAllForUser returns exactly the ids it revoked and leaves other users untouched", async () => {
      const owner = await user("revoke-all@example.com");
      const other = await user("revoke-all-other@example.com");
      const now = new Date();
      const first = await pendingCredential(owner, 60, future());
      const second = await pendingCredential(owner, 61, future());
      const already = await pendingCredential(owner, 62, future());
      const kept = await pendingCredential(other, 63, future());
      await credentials.revoke({ userId: owner }, already.credentialId, past());
      await credentials.activate({ userId: other }, kept.credentialId, now);

      const alreadyBefore = await credentials.findByCredentialId(already.credentialId);
      const revoked = await credentials.revokeAllForUser({ userId: owner }, now);

      expect(revoked.sort()).toEqual([first.id, second.id].sort());
      expect(await credentials.countActiveByUser({ userId: other })).toBe(1);
      const ownerRows = await credentials.listByUser({ userId: owner });
      const revokedIds = new Set(revoked);
      const newlyRevoked = ownerRows.filter((row) =>
        revokedIds.has(row.id as (typeof revoked)[number]),
      );
      expect(newlyRevoked).toHaveLength(2);
      expect(newlyRevoked.every((row) => row.revokedAt !== null)).toBe(true);
      const alreadyAfter = await credentials.findByCredentialId(already.credentialId);
      expect(alreadyAfter?.revokedAt).toEqual(alreadyBefore?.revokedAt);
    });

    it("records use and renames only the owner's credential", async () => {
      const owner = await user("use@example.com");
      const { credentialId } = await pendingCredential(owner, 70, future());
      const usedAt = future();
      expect(await credentials.recordUse({ userId: owner }, credentialId, 2, usedAt)).toBe(false);
      expect(await credentials.activate({ userId: owner }, credentialId, past())).toBe(true);
      expect(await credentials.recordUse({ userId: owner }, credentialId, 2, usedAt)).toBe(true);
      const used = await credentials.findByCredentialId(credentialId);
      expect(used?.signCount).toBe(2);
      expect(used?.lastUsedAt).not.toBeNull();
      expect(await credentials.rename({ userId: owner }, credentialId, "Casa")).toBe(true);
      expect((await credentials.findByCredentialId(credentialId))?.name).toBe("Casa");
      expect(await credentials.rename({ userId: UUIDv7() }, credentialId, "Ajena")).toBe(false);
    });

    it("deleteExpiredPending removes only expired pending rows, and never more than its limit", async () => {
      const owner = await user("pending@example.com");
      for (let i = 0; i < 4; i++) await pendingCredential(owner, 80 + i, past());
      const futurePending = await pendingCredential(owner, 90, future());
      const noDeadline = await pendingCredential(owner, 91, null);
      const active = await pendingCredential(owner, 92, future());
      expect(await credentials.activate({ userId: owner }, active.credentialId, new Date())).toBe(
        true,
      );
      await db
        .update(passkeyCredentials)
        .set({ pendingExpiresAt: past() })
        .where(eq(passkeyCredentials.id, active.id));
      const stillPendingActive = await pendingCredential(owner, 93, future());
      expect(
        await credentials.activate({ userId: owner }, stillPendingActive.credentialId, new Date()),
      ).toBe(true);

      expect(await credentials.deleteExpiredPending(2)).toBe(2);
      const left = await db.select().from(passkeyCredentials);
      const expiredPending = left.filter(
        (row) =>
          row.activatedAt === null &&
          row.pendingExpiresAt !== null &&
          row.pendingExpiresAt < new Date(),
      );
      expect(expiredPending).toHaveLength(2);
      expect(left.map((row) => row.id)).toEqual(
        expect.arrayContaining([futurePending.id, noDeadline.id, active.id, stillPendingActive.id]),
      );

      const before = Number(
        (await db.select({ total: count() }).from(passkeyCredentials))[0]?.total,
      );
      expect(await credentials.deleteExpiredPending(0)).toBe(0);
      const after = Number(
        (await db.select({ total: count() }).from(passkeyCredentials))[0]?.total,
      );
      expect(after).toBe(before);
    });

    it("caps deleteExpiredPending at its limit even when asked for more", async () => {
      const owner = await user("cap@example.com");
      await db.insert(passkeyCredentials).values(
        Array.from({ length: PASSKEY_PENDING_CLEANUP_LIMIT + 1 }, (_, i) => ({
          id: UUIDv7(),
          credentialId: bytes(16, 100 + i),
          userId: owner,
          publicKey: bytes(8, 1),
          coseAlgorithm: -7,
          signCount: 0,
          transports: null,
          aaguid: null,
          backupEligible: false,
          backupState: false,
          name: "Pendiente",
          pendingExpiresAt: past(),
        })),
      );

      expect(await credentials.deleteExpiredPending(PASSKEY_PENDING_CLEANUP_LIMIT + 50)).toBe(
        PASSKEY_PENDING_CLEANUP_LIMIT,
      );
      const left = await db
        .select({ total: count() })
        .from(passkeyCredentials)
        .where(isNull(passkeyCredentials.activatedAt));
      expect(Number(left[0]?.total)).toBe(1);
    });

    it("refuses a credential for a user that does not exist", async () => {
      await expect(pendingCredential(UUIDv7(), 110, null)).rejects.toBeInstanceOf(
        PasskeyUserNotFound,
      );
    });
  });

  describe("user handles", () => {
    it("returns one handle when two calls race, and the same handle afterwards", async () => {
      const owner = await user("handle@example.com");
      const [first, second] = await Promise.all([
        handles.getOrCreateForUser({ userId: owner }),
        handles.getOrCreateForUser({ userId: owner }),
      ]);

      expect(first.equals(second)).toBe(true);
      expect(first).toHaveLength(32);
      const again = await handles.getOrCreateForUser({ userId: owner });
      expect(again.equals(first)).toBe(true);
      const rows = await db
        .select()
        .from(passkeyUserHandles)
        .where(eq(passkeyUserHandles.userId, owner));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.handle.equals(first)).toBe(true);
    });

    it("refuses a handle for a user that does not exist", async () => {
      await expect(handles.getOrCreateForUser({ userId: UUIDv7() })).rejects.toBeInstanceOf(
        PasskeyUserNotFound,
      );
    });
  });

  describe("erasure", () => {
    it("removes that user's credentials, handle and challenges, and nothing of anyone else", async () => {
      const owner = await user("erase-passkey@example.com");
      const other = await user("keep-passkey@example.com");
      const ownCredential = await pendingCredential(owner, 120, future());
      const otherCredential = await pendingCredential(other, 121, future());
      const ownHandle = await handles.getOrCreateForUser({ userId: owner });
      const otherHandle = await handles.getOrCreateForUser({ userId: other });
      const ownChallenge = bytes(32, 122);
      const otherChallenge = bytes(32, 123);
      const nameless = bytes(32, 124);
      await challenges.create({
        challenge: ownChallenge,
        purpose: "registration",
        userId: owner,
        sessionBindingHash: bytes(32, 125),
        expiresAt: future(),
      });
      await challenges.create({
        challenge: otherChallenge,
        purpose: "authentication",
        userId: other,
        sessionBindingHash: null,
        expiresAt: future(),
      });
      await challenges.create({
        challenge: nameless,
        purpose: "authentication",
        userId: null,
        sessionBindingHash: null,
        expiresAt: future(),
      });

      await erasure.eraseIdentityData(owner);

      expect(
        await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, owner)),
      ).toHaveLength(0);
      expect(
        await db.select().from(passkeyUserHandles).where(eq(passkeyUserHandles.userId, owner)),
      ).toHaveLength(0);
      expect(
        await db.select().from(passkeyChallenges).where(eq(passkeyChallenges.userId, owner)),
      ).toHaveLength(0);

      const keptCredential = await credentials.findByCredentialId(otherCredential.credentialId);
      expect(keptCredential?.userId).toBe(other);
      expect(keptCredential?.id).toBe(otherCredential.id);
      const keptHandle = await db
        .select()
        .from(passkeyUserHandles)
        .where(eq(passkeyUserHandles.userId, other));
      expect(keptHandle[0]?.handle.equals(otherHandle)).toBe(true);
      expect(ownHandle.equals(otherHandle)).toBe(false);
      const keptChallenges = await db
        .select({ challenge: passkeyChallenges.challenge })
        .from(passkeyChallenges);
      const keptBytes = keptChallenges.map((row) => row.challenge);
      expect(keptBytes.some((value) => value.equals(otherChallenge))).toBe(true);
      expect(keptBytes.some((value) => value.equals(nameless))).toBe(true);
      expect(keptBytes.some((value) => value.equals(ownChallenge))).toBe(false);
      expect(await credentials.findByCredentialId(ownCredential.credentialId)).toBeNull();
    });
  });
});
