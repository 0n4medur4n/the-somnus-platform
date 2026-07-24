/**
 * Helpers for the Firebase Auth + Firestore emulators the edge-api
 * integration tests run against. The emulators are started (and their
 * FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST env vars set)
 * by `firebase emulators:exec` -- see this service's package.json
 * `test` script and README. These helpers only talk to whatever the
 * env vars point at.
 */

export const TEST_PROJECT_ID = process.env["FIREBASE_PROJECT_ID"] ?? "somnus-dev-test";

function authHost(): string {
  const host = process.env["FIREBASE_AUTH_EMULATOR_HOST"];
  if (!host) {
    throw new Error(
      "FIREBASE_AUTH_EMULATOR_HOST is not set. Run the edge-api tests via `firebase emulators:exec` (see README).",
    );
  }
  return host;
}

function firestoreHost(): string {
  const host = process.env["FIRESTORE_EMULATOR_HOST"];
  if (!host) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set. Run the edge-api tests via `firebase emulators:exec` (see README).",
    );
  }
  return host;
}

/** Create a user in the Auth emulator and return a real, valid ID token for it. */
export async function signUpTestUser(
  email: string,
  password = "password123",
): Promise<{ idToken: string; uid: string }> {
  const res = await fetch(
    `http://${authHost()}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const json = (await res.json()) as { idToken?: string; localId?: string; error?: unknown };
  if (!json.idToken || !json.localId) {
    throw new Error(`Auth emulator signUp failed: ${JSON.stringify(json)}`);
  }
  return { idToken: json.idToken, uid: json.localId };
}

/**
 * Craft a structurally valid but EXPIRED Firebase ID token. In
 * emulator mode, firebase-admin's verifyIdToken skips signature
 * verification but still enforces exp -- so an `alg:none` token with a
 * past `exp` is rejected with `auth/id-token-expired`, exactly the
 * negative case Checkpoint 8.1 requires (verified empirically before
 * writing this).
 */
export function makeExpiredIdToken(uid = "expiredUser", email = "expired@example.com"): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const nowSec = Math.floor(Date.now() / 1000);
  const past = nowSec - 3600;
  const header = { alg: "none", typ: "JWT" };
  const payload = {
    iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
    aud: TEST_PROJECT_ID,
    sub: uid,
    user_id: uid,
    iat: past - 60,
    exp: past,
    auth_time: past - 60,
    email,
    firebase: { identities: {}, sign_in_provider: "password" },
  };
  return `${b64url(header)}.${b64url(payload)}.`;
}

/** Wipe all Auth emulator accounts between tests. */
export async function clearAuthEmulator(): Promise<void> {
  await fetch(`http://${authHost()}/emulator/v1/projects/${TEST_PROJECT_ID}/accounts`, {
    method: "DELETE",
  });
}

/** Wipe all Firestore emulator documents between tests. */
export async function clearFirestoreEmulator(): Promise<void> {
  await fetch(
    `http://${firestoreHost()}/emulator/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
}
