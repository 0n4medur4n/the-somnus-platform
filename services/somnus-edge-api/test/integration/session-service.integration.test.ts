import { UUIDv7 } from "@somnus/api-contracts";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { EMAIL_LINK_AMR } from "../../src/modules/sessions/classify-session.js";
import {
  CONSOLE_ABSOLUTE_MS,
  CONSOLE_IDLE_MS,
  SessionService,
} from "../../src/modules/sessions/session.service.js";
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
    const authTime = new Date("2020-09-13T12:26:40.000Z");
    const created = await sessions.create({
      firebaseUid: "user-classified",
      email: "c@example.com",
      ttlSeconds: 3600,
      now,
      client: "console",
      amr: [EMAIL_LINK_AMR],
      authTime,
      stepUpAt: null,
    });
    expect(created).toMatchObject({
      client: "console",
      amr: [EMAIL_LINK_AMR],
      stepUpAt: null,
    });
    expect(created.authTime?.toISOString()).toBe(authTime.toISOString());
    expect(created.createdAt.toISOString()).toBe(now.toISOString());

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
    expect((second["authTime"] as Timestamp).toMillis()).toBe(authTime.getTime());
    expect((second["expiresAt"] as Timestamp).toMillis()).toBe(
      authTime.getTime() + CONSOLE_ABSOLUTE_MS,
    );
    expect((second["lastSeenAt"] as Timestamp).toMillis()).toBe(now.getTime());
    expect(second["somnusUserId"]).toBe("018f0000-0000-7000-8000-0000000000aa");
  });

  it("ends a console session at 30 minutes idle and at 10 hours, and writes lastSeenAt once a minute", async () => {
    const start = new Date("2026-11-23T12:00:00.000Z");
    const created = await sessions.create({
      firebaseUid: "console-limits",
      email: "c@example.com",
      ttlSeconds: 60 * 60 * 24 * 7,
      now: start,
      client: "console",
      amr: [EMAIL_LINK_AMR],
      authTime: start,
      stepUpAt: null,
    });
    expect(created.expiresAt.getTime() - start.getTime()).toBe(CONSOLE_ABSOLUTE_MS);

    const withinMinute = new Date(start.getTime() + 30_000);
    expect(await sessions.validate(created.sessionId, withinMinute)).not.toBeNull();
    const once = (
      await firebase.firestore.collection("sessions").doc(created.sessionId).get()
    ).data();
    if (once === undefined) throw new Error("session document missing");
    expect((once["lastSeenAt"] as Timestamp).toMillis()).toBe(start.getTime());

    const afterMinute = new Date(start.getTime() + 60_000);
    expect(await sessions.validate(created.sessionId, afterMinute)).not.toBeNull();
    const twice = (
      await firebase.firestore.collection("sessions").doc(created.sessionId).get()
    ).data();
    if (twice === undefined) throw new Error("session document missing");
    expect((twice["lastSeenAt"] as Timestamp).toMillis()).toBe(afterMinute.getTime());

    const idle = new Date(afterMinute.getTime() + CONSOLE_IDLE_MS);
    expect(await sessions.validate(created.sessionId, idle)).toBeNull();
    const afterIdle = (
      await firebase.firestore.collection("sessions").doc(created.sessionId).get()
    ).data();
    if (afterIdle === undefined) throw new Error("session document missing");
    expect((afterIdle["lastSeenAt"] as Timestamp).toMillis()).toBe(afterMinute.getTime());

    const fresh = await sessions.create({
      firebaseUid: "console-absolute",
      email: null,
      ttlSeconds: 60 * 60 * 24 * 7,
      now: start,
      client: "console",
      amr: [EMAIL_LINK_AMR],
      authTime: start,
      stepUpAt: null,
    });
    const pastAbsolute = new Date(start.getTime() + CONSOLE_ABSOLUTE_MS);
    expect(await sessions.validate(fresh.sessionId, pastAbsolute)).toBeNull();
  });

  it("keeps a web session for its stored expiry and does not write lastSeenAt", async () => {
    const start = new Date("2026-11-23T12:00:00.000Z");
    const created = await sessions.create({
      firebaseUid: "web-limits",
      email: null,
      ttlSeconds: 3_600,
      now: start,
      client: "app",
      amr: [EMAIL_LINK_AMR],
      authTime: new Date(start.getTime() - CONSOLE_ABSOLUTE_MS - 1),
      stepUpAt: null,
    });
    const later = new Date(start.getTime() + CONSOLE_IDLE_MS + 60_000);
    expect(await sessions.validate(created.sessionId, later)).not.toBeNull();
    const stored = (
      await firebase.firestore.collection("sessions").doc(created.sessionId).get()
    ).data();
    if (stored === undefined) throw new Error("session document missing");
    expect(stored).not.toHaveProperty("lastSeenAt");
    expect((stored["expiresAt"] as Timestamp).toMillis()).toBe(start.getTime() + 3_600_000);
  });

  it("stores a step-up time when create is given one", async () => {
    const now = new Date();
    const stepUpAt = new Date(now.getTime() + 60_000);
    const created = await sessions.create({
      firebaseUid: "step-up",
      email: null,
      emailVerified: false,
      ttlSeconds: 3600,
      now,
      client: "app",
      amr: [EMAIL_LINK_AMR],
      authTime: new Date("2020-01-01T00:00:00.000Z"),
      stepUpAt,
    });
    expect(created.stepUpAt?.toISOString()).toBe(stepUpAt.toISOString());
    const found = await sessions.validate(created.sessionId);
    expect(found?.stepUpAt?.toISOString()).toBe(stepUpAt.toISOString());
    expect(found?.emailVerified).toBe(false);
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
