import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, connectAuthEmulator, initializeAuth, inMemoryPersistence } from "firebase/auth";
import { env } from "../config/env.js";

let appInstance: FirebaseApp | undefined;
let authInstance: Auth | undefined;

/**
 * Firebase Auth keeps nothing in browser storage (build plan §5.2 / §10).
 * inMemoryPersistence is used instead of getAuth so the SDK never installs
 * localStorage or IndexedDB persistence. The refresh token dies on reload.
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
