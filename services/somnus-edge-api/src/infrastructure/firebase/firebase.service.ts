import { Injectable } from "@nestjs/common";
import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/**
 * Thin wrapper around firebase-admin. Two responsibilities:
 *
 *  - Verify Firebase ID tokens (`verifyIdToken`) -- this is the ONLY
 *    thing edge-api trusts a client-supplied token for. The verified
 *    identity is then exchanged for a server-side session (see
 *    SessionService); the ID token itself is never persisted or
 *    forwarded.
 *  - Provide the Firestore handle the session store uses (build plan
 *    §9: Firestore may hold short-lived session lookup state).
 *
 * Emulator vs. real: firebase-admin reads FIREBASE_AUTH_EMULATOR_HOST
 * and FIRESTORE_EMULATOR_HOST from the environment itself. When set
 * (local dev, docker-compose, CI), initializeApp with just a projectId
 * is enough -- no service-account credentials. In production, no
 * emulator vars are set and initializeApp() uses the Cloud Run service
 * account's Application Default Credentials.
 *
 * NOTE (build plan Checkpoint 8.1): the emulator does NOT enforce
 * Firebase's own refresh-token revocation (revokeRefreshTokens +
 * verifyIdToken/checkRevoked is a no-op there), which is exactly why
 * session revocation is done in our own Firestore session store, not
 * via Firebase. `verifyIdToken` is called with checkRevoked=false: the
 * ID token is a short-lived proof of a *fresh* Firebase sign-in used
 * only at exchange time; ongoing revocation is the session store's job.
 */
@Injectable()
export class FirebaseService {
  private readonly app: App;
  private readonly authClient: Auth;
  private readonly firestoreClient: Firestore;

  constructor(projectId: string) {
    // getApps() guard: NestJS can construct providers more than once
    // across test modules in one process, and initializeApp throws on a
    // duplicate default app.
    const existing = getApps();
    this.app = existing.length > 0 ? (existing[0] as App) : initializeApp({ projectId });
    this.authClient = getAuth(this.app);
    this.firestoreClient = getFirestore(this.app);
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    return this.authClient.verifyIdToken(idToken, false);
  }

  get firestore(): Firestore {
    return this.firestoreClient;
  }
}
