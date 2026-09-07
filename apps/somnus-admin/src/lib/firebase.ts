import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, connectAuthEmulator, initializeAuth, inMemoryPersistence } from "firebase/auth";
import { env } from "../config/env.js";

let appInstance: FirebaseApp | undefined;
let authInstance: Auth | undefined;

/**
 * Firebase Auth, configured to keep NOTHING in browser storage
 * (build plan §5.2 / §10). We use `initializeAuth` with
 * `inMemoryPersistence` rather than `getAuth` precisely so Firebase
 * never installs its default localStorage/IndexedDB persistence: the
 * refresh token lives only in memory and is gone on reload. The app's
 * durable auth is the edge session cookie, not Firebase.
 * `no-token-storage.test.ts` asserts this holds.
 */
export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    appInstance = initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
    });
    authInstance = initializeAuth(appInstance, { persistence: inMemoryPersistence });
    if (env.VITE_AUTH_EMULATOR_URL) {
      connectAuthEmulator(authInstance, env.VITE_AUTH_EMULATOR_URL, { disableWarnings: true });
    }
  }
  return authInstance;
}
