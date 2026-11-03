import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { SessionService } from "../../src/modules/sessions/session.service.js";
import { clearFirestoreEmulator, signUpTestUser, TEST_PROJECT_ID } from "../support/emulator.js";

/**
 * Exercises the Firestore-backed session store directly (against the
 * Firestore emulator), covering the store's own branches -- expiry and
 * idempotent revoke -- that the HTTP flow doesn't reach because the
 * session guard short-circuits first.
 */
describe("SessionService (Firestore-backed session store)", () => {
  const firebase = new FirebaseService(TEST_PROJECT_ID, TEST_PROJECT_ID);
  const sessions = new SessionService(firebase);

  beforeEach(async () => {
    await clearFirestoreEmulator();
  });

  it("create() then validate() returns the record", async () => {
    const created = await sessions.create({
      firebaseUid: "user-1",
      email: "u1@example.com",
      ttlSeconds: 3600,
    });
    const found = await sessions.validate(created.sessionId);
    expect(found?.firebaseUid).toBe("user-1");
    expect(found?.email).toBe("u1@example.com");
  });

  it("validate() returns null for a session id that does not exist", async () => {
    expect(await sessions.validate(UUIDv7())).toBeNull();
  });

  it("validate() returns null once the session has expired", async () => {
    const created = await sessions.create({
      firebaseUid: "user-2",
      email: null,
      ttlSeconds: 60,
    });
    // A clock one second past expiry.
    const afterExpiry = new Date(created.expiresAt.getTime() + 1000);
    expect(await sessions.validate(created.sessionId, afterExpiry)).toBeNull();
  });

  it("revoke() then validate() returns null immediately", async () => {
    const created = await sessions.create({ firebaseUid: "user-3", email: null, ttlSeconds: 3600 });
    expect(await sessions.validate(created.sessionId)).not.toBeNull();
    await sessions.revoke(created.sessionId);
    expect(await sessions.validate(created.sessionId)).toBeNull();
  });

  it("revoke() is idempotent: double-revoke and revoking a missing session both succeed", async () => {
    const created = await sessions.create({ firebaseUid: "user-4", email: null, ttlSeconds: 3600 });
    await sessions.revoke(created.sessionId);
    // Already revoked -- no-op, no throw.
    await expect(sessions.revoke(created.sessionId)).resolves.toBeUndefined();
    // Never existed -- no-op, no throw.
    await expect(sessions.revoke(UUIDv7())).resolves.toBeUndefined();
  });

  it("create() starts with a null somnusUserId until it is resolved", async () => {
    const created = await sessions.create({ firebaseUid: "user-5", email: null, ttlSeconds: 3600 });
    expect(created.somnusUserId).toBeNull();
    const found = await sessions.validate(created.sessionId);
    expect(found?.somnusUserId).toBeNull();
  });

  it("setSomnusUserId() memoizes the resolved id, readable on the next validate()", async () => {
    const created = await sessions.create({ firebaseUid: "user-6", email: null, ttlSeconds: 3600 });
    await sessions.setSomnusUserId(created.sessionId, "018f0000-0000-7000-8000-0000000000aa");
    const found = await sessions.validate(created.sessionId);
    expect(found?.somnusUserId).toBe("018f0000-0000-7000-8000-0000000000aa");
  });

  it("setSomnusUserId() is a no-op for a session that does not exist", async () => {
    await expect(sessions.setSomnusUserId(UUIDv7(), "x")).resolves.toBeUndefined();
  });
});

describe("SessionService.eraseSignInIdentity (account deletion)", () => {
  const firebase = new FirebaseService(TEST_PROJECT_ID, TEST_PROJECT_ID);
  const sessions = new SessionService(firebase);

  beforeEach(async () => {
    await clearFirestoreEmulator();
  });

  it("deletes every session of the account, and only that account's", async () => {
    const mine = await sessions.create({
      firebaseUid: "erase-1",
      email: "a@example.com",
      ttlSeconds: 3600,
    });
    const mineToo = await sessions.create({
      firebaseUid: "erase-1",
      email: "a@example.com",
      ttlSeconds: 3600,
    });
    const theirs = await sessions.create({
      firebaseUid: "erase-2",
      email: "b@example.com",
      ttlSeconds: 3600,
    });

    await sessions.eraseSignInIdentity("erase-1");

    expect(await sessions.validate(mine.sessionId)).toBeNull();
    expect(await sessions.validate(mineToo.sessionId)).toBeNull();
    expect(await sessions.validate(theirs.sessionId)).not.toBeNull();
    // Gone, not merely revoked: nothing is left holding the address.
    const left = await firebase.firestore
      .collection("sessions")
      .where("firebaseUid", "==", "erase-1")
      .get();
    expect(left.empty).toBe(true);
  });

  it("deletes the Firebase Authentication account, so its email can register again", async () => {
    const { uid } = await signUpTestUser("erase-me@example.com");
    await sessions.create({ firebaseUid: uid, email: "erase-me@example.com", ttlSeconds: 3600 });

    await sessions.eraseSignInIdentity(uid);

    // Only possible once the first account no longer exists.
    await expect(signUpTestUser("erase-me@example.com")).resolves.toMatchObject({
      uid: expect.any(String),
    });
  });

  it("is not an error when the account is already gone", async () => {
    await expect(sessions.eraseSignInIdentity("never-existed")).resolves.toBeUndefined();
  });
});
