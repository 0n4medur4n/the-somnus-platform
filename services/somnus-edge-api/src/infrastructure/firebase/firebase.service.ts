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
 * ## Two projects, two apps, on purpose
 *
 * Auth and Firestore live in different GCP projects, so they get different
 * firebase-admin apps:
 *
 *  - **Auth** in the Firebase project (`FIREBASE_PROJECT_ID`, e.g.
 *    `the-somnuss`), because Firebase Hosting and Authentication require a
 *    Firebase project and the ID tokens are issued for it. `verifyIdToken`
 *    checks `aud`/`iss` against exactly this id.
 *  - **Firestore** in the platform's own project (`FIRESTORE_PROJECT_ID`, e.g.
 *    `the-somnus`), where TiDB, Secret Manager and every service account
 *    already are. Same-project access needs no cross-project IAM grant.
 *
 * They are two separate settings rather than one, and that is the whole point.
 * The Firestore client used to be built from the Auth project id, which pointed
 * every session write at a project that had no Firestore database in it: each
 * `POST /v1/sessions` failed with gRPC 5 NOT_FOUND on the first write. A single
 * shared id is exactly how that happens, so there is deliberately no fallback
 * from one to the other -- an unset `FIRESTORE_PROJECT_ID` takes its own default
 * and never borrows the Auth project's.
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

/** The named app that owns the Firestore client. The default app stays Auth's. */
const FIRESTORE_APP_NAME = "somnus-firestore";

/**
 * Reuse an app by name, or create it.
 *
 * Name-aware rather than "whichever app exists": NestJS can construct providers
 * more than once across test modules in one process, `initializeApp` throws on a
 * duplicate name, and with two apps in play "the first one" is no longer
 * necessarily the one being asked for.
 */
function appNamed(name: string | undefined, projectId: string): App {
  const wanted = name ?? "[DEFAULT]";
  const existing = getApps().find((candidate) => candidate.name === wanted);
  if (existing) return existing;
  return name === undefined ? initializeApp({ projectId }) : initializeApp({ projectId }, name);
}

@Injectable()
export class FirebaseService {
  private readonly authApp: App;
  private readonly firestoreApp: App;
  private readonly authClient: Auth;
  private readonly firestoreClient: Firestore;

  constructor(projectId: string, firestoreProjectId: string) {
    this.authApp = appNamed(undefined, projectId);
    this.firestoreApp = appNamed(FIRESTORE_APP_NAME, firestoreProjectId);
    this.authClient = getAuth(this.authApp);
    this.firestoreClient = getFirestore(this.firestoreApp);
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    return this.authClient.verifyIdToken(idToken, false);
  }

  get firestore(): Firestore {
    return this.firestoreClient;
  }
}
