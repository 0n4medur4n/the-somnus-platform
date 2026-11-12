import { UUIDv7 } from "@somnus/api-contracts";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { EMAIL_LINK_AMR } from "../../src/modules/sessions/classify-session.js";
import { SessionService } from "../../src/modules/sessions/session.service.js";
import { clearFirestoreEmulator, signUpTestUser, TEST_PROJECT_ID } from "../support/emulator.js";

function open(
  sessions: SessionService,
  input: { firebaseUid: string; email: string | null; ttlSeconds: number },
) {
  const now = new Date();
  return sessions.create({
    ...input,
    now,
    client: "app",
    amr: [EMAIL_LINK_AMR],
    authTime: now,
    stepUpAt: null,
  });
}

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
    const created = await open(sessions, {
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
    const created = await open(sessions, {
      firebaseUid: "user-2",
      email: null,
      ttlSeconds: 60,
    });
    // A clock one second past expiry.
    const afterExpiry = new Date(created.expiresAt.getTime() + 1000);
    expect(await sessions.validate(created.sessionId, afterExpiry)).toBeNull();
  });

  it("revoke() then validate() returns null immediately", async () => {
    const created = await open(sessions, { firebaseUid: "user-3", email: null, ttlSeconds: 3600 });
    expect(await sessions.validate(created.sessionId)).not.toBeNull();
    await sessions.revoke(created.sessionId);
    expect(await sessions.validate(created.sessionId)).toBeNull();
  });

  it("revoke() is idempotent: double-revoke and revoking a missing session both succeed", async () => {
    const created = await open(sessions, { firebaseUid: "user-4", email: null, ttlSeconds: 3600 });
    await sessions.revoke(created.sessionId);
    // Already revoked -- no-op, no throw.
    await expect(sessions.revoke(created.sessionId)).resolves.toBeUndefined();
    // Never existed -- no-op, no throw.
    await expect(sessions.revoke(UUIDv7())).resolves.toBeUndefined();
  });

  it("create() starts with a null somnusUserId until it is resolved", async () => {
    const created = await open(sessions, { firebaseUid: "user-5", email: null, ttlSeconds: 3600 });
    expect(created.somnusUserId).toBeNull();
    const found = await sessions.validate(created.sessionId);
    expect(found?.somnusUserId).toBeNull();
  });

  it("setSomnusUserId() memoizes the resolved id, readable on the next validate()", async () => {
    const created = await open(sessions, { firebaseUid: "user-6", email: null, ttlSeconds: 3600 });
    await sessions.setSomnusUserId(created.sessionId, "018f0000-0000-7000-8000-0000000000aa");
    const found = await sessions.validate(created.sessionId);
    expect(found?.somnusUserId).toBe("018f0000-0000-7000-8000-0000000000aa");
  });

  it("setSomnusUserId() is a no-op for a session that does not exist", async () => {
    await expect(sessions.setSomnusUserId(UUIDv7(), "x")).resolves.toBeUndefined();
  });

  it("writes client, amr, authTime and stepUpAt once, and later writes leave them", async () => {
    const now = new Date("2026-11-12T12:00:00.000Z");
    const created = await sessions.create({
      firebaseUid: "user-classified",
      email: "c@example.com",
      ttlSeconds: 3600,
      now,
      client: "console",
      amr: [EMAIL_LINK_AMR],
      authTime: now,
      stepUpAt: null,
    });
    expect(created).toMatchObject({
      client: "console",
      amr: [EMAIL_LINK_AMR],
      stepUpAt: null,
    });
    expect(created.authTime?.toISOString()).toBe(now.toISOString());

    const before = await firebase.firestore.collection("sessions").doc(created.sessionId).get();
    await sessions.validate(created.sessionId);
    await sessions.validate(created.sessionId);
    await sessions.setSomnusUserId(created.sessionId, "018f0000-0000-7000-8000-0000000000aa");
    await sessions.revoke(created.sessionId);
    const after = await firebase.firestore.collection("sessions").doc(created.sessionId).get();
    const first = before.data();
    const second = after.data();
    if (first === undefined || second === undefined) throw new Error("session document missing");
    expect(second["client"]).toBe("console");
    expect(second["amr"]).toEqual([EMAIL_LINK_AMR]);
    expect(second["stepUpAt"]).toBeNull();
    expect(second["authTime"]).toEqual(first["authTime"]);
    expect((second["expiresAt"] as Timestamp).toMillis()).toBe(now.getTime() + 3_600_000);
    expect(second["somnusUserId"]).toBe("018f0000-0000-7000-8000-0000000000aa");
    expect(second).not.toHaveProperty("lastSeenAt");
  });

  it("validate() accepts a document with none of the new fields and does not add them", async () => {
    const sessionId = UUIDv7();
    const createdAt = new Date("2026-11-01T00:00:00.000Z");
    await firebase.firestore
      .collection("sessions")
      .doc(sessionId)
      .set({
        firebaseUid: "legacy",
        email: "legacy@example.com",
        createdAt: Timestamp.fromDate(createdAt),
        expiresAt: Timestamp.fromMillis(createdAt.getTime() + 3_600_000),
        revokedAt: null,
      });

    const found = await sessions.validate(sessionId, new Date("2026-11-01T00:30:00.000Z"));
    expect(found).toMatchObject({
      sessionId,
      firebaseUid: "legacy",
      email: "legacy@example.com",
      revokedAt: null,
      somnusUserId: null,
    });
    expect(found).not.toHaveProperty("client");
    expect(found).not.toHaveProperty("amr");
    expect(found).not.toHaveProperty("authTime");
    expect(found).not.toHaveProperty("stepUpAt");

    await sessions.validate(sessionId, new Date("2026-11-01T00:30:00.000Z"));
    const stored = await firebase.firestore.collection("sessions").doc(sessionId).get();
    expect(Object.keys(stored.data() ?? {}).sort()).toEqual([
      "createdAt",
      "email",
      "expiresAt",
      "firebaseUid",
      "revokedAt",
    ]);
  });

  it("validate() ignores a new field that is not the shape written at creation", async () => {
    const sessionId = UUIDv7();
    const stepUpAt = new Date("2026-11-12T12:05:00.000Z");
    await firebase.firestore
      .collection("sessions")
      .doc(sessionId)
      .set({
        firebaseUid: "odd",
        email: null,
        createdAt: Timestamp.fromDate(new Date()),
        expiresAt: Timestamp.fromMillis(Date.now() + 3_600_000),
        revokedAt: null,
        client: "https://console.thesomnus.com",
        amr: ["email_link", 1],
        authTime: "now",
        stepUpAt: "no",
      });

    const found = await sessions.validate(sessionId);
    expect(found?.firebaseUid).toBe("odd");
    expect(found).not.toHaveProperty("client");
    expect(found).not.toHaveProperty("amr");
    expect(found).not.toHaveProperty("authTime");
    expect(found).not.toHaveProperty("stepUpAt");
    const stored = await firebase.firestore.collection("sessions").doc(sessionId).get();
    expect(stored.data()?.["client"]).toBe("https://console.thesomnus.com");

    const stamped = UUIDv7();
    await firebase.firestore
      .collection("sessions")
      .doc(stamped)
      .set({
        firebaseUid: "stamped",
        email: null,
        createdAt: Timestamp.fromDate(stepUpAt),
        expiresAt: Timestamp.fromMillis(stepUpAt.getTime() + 3_600_000),
        revokedAt: null,
        client: "app",
        amr: [EMAIL_LINK_AMR],
        authTime: Timestamp.fromDate(stepUpAt),
        stepUpAt: Timestamp.fromDate(stepUpAt),
      });
    const read = await sessions.validate(stamped, stepUpAt);
    expect(read?.client).toBe("app");
    expect(read?.amr).toEqual([EMAIL_LINK_AMR]);
    expect(read?.authTime?.toISOString()).toBe(stepUpAt.toISOString());
    expect(read?.stepUpAt?.toISOString()).toBe(stepUpAt.toISOString());
  });
});

describe("SessionService.eraseSignInIdentity (account deletion)", () => {
  const firebase = new FirebaseService(TEST_PROJECT_ID, TEST_PROJECT_ID);
  const sessions = new SessionService(firebase);

  beforeEach(async () => {
    await clearFirestoreEmulator();
  });

  it("deletes every session of the account, and only that account's", async () => {
    const mine = await open(sessions, {
      firebaseUid: "erase-1",
      email: "a@example.com",
      ttlSeconds: 3600,
    });
    const mineToo = await open(sessions, {
      firebaseUid: "erase-1",
      email: "a@example.com",
      ttlSeconds: 3600,
    });
    const theirs = await open(sessions, {
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
    await open(sessions, { firebaseUid: uid, email: "erase-me@example.com", ttlSeconds: 3600 });

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
