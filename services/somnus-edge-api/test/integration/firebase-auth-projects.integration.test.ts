import { beforeEach, describe, expect, it } from "vitest";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import {
  clearAuthEmulator,
  signUpTestUser,
  TEST_FIRESTORE_PROJECT_ID,
  TEST_PROJECT_ID,
} from "../support/emulator.js";

/**
 * A token is accepted only by the project its `aud` names, and only if that
 * project is configured -- whether FIREBASE_PROJECT_ID names one project or,
 * during a migration, several. Run against the Auth emulator, whose tokens
 * carry `aud = TEST_PROJECT_ID`.
 */
describe("FirebaseService with one or several Auth projects", () => {
  beforeEach(async () => {
    await clearAuthEmulator();
  });

  it("accepts a token from a project in the list, wherever it sits in the list", async () => {
    const { idToken, uid } = await signUpTestUser("listed@example.com");
    const firebase = new FirebaseService(
      `some-other-project,${TEST_PROJECT_ID}`,
      TEST_FIRESTORE_PROJECT_ID,
    );
    const decoded = await firebase.verifyIdToken(idToken);
    expect(decoded.uid).toBe(uid);
  });

  it("rejects a token from a project that is not in the list", async () => {
    const { idToken } = await signUpTestUser("unlisted@example.com");
    const firebase = new FirebaseService("some-other-project", TEST_FIRESTORE_PROJECT_ID);
    await expect(firebase.verifyIdToken(idToken)).rejects.toThrow();
  });

  it("rejects a token whose aud was rewritten to a listed project", async () => {
    // Routing reads `aud` unverified; this proves that is all it does. The
    // chosen project still verifies the token, and a payload edited to name it
    // no longer matches anything that project issued.
    const { idToken } = await signUpTestUser("forged@example.com");
    const [header, payload, signature] = idToken.split(".");
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const forged = [
      header,
      Buffer.from(JSON.stringify({ ...claims, aud: "some-other-project" })).toString("base64url"),
      signature,
    ].join(".");
    const firebase = new FirebaseService(
      `some-other-project,${TEST_PROJECT_ID}`,
      TEST_FIRESTORE_PROJECT_ID,
    );
    await expect(firebase.verifyIdToken(forged)).rejects.toThrow();
  });
});
