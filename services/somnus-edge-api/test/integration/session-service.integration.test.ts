import { UUIDv7 } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { SessionService } from "../../src/modules/sessions/session.service.js";
import { clearFirestoreEmulator, TEST_PROJECT_ID } from "../support/emulator.js";

/**
 * Exercises the Firestore-backed session store directly (against the
 * Firestore emulator), covering the store's own branches -- expiry and
 * idempotent revoke -- that the HTTP flow doesn't reach because the
 * session guard short-circuits first.
 */
describe("SessionService (Firestore-backed session store)", () => {
  const firebase = new FirebaseService(TEST_PROJECT_ID);
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
});
