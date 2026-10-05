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
 * ## Auth projects: one, or a short list during a migration
 *
 * `FIREBASE_PROJECT_ID` names the project whose ID tokens are accepted. It may
 * be a comma-separated list, and is one while Authentication moves between
 * projects (2026-10, from `the-somnuss` into `the-somnus`): users signed in
 * against either project keep working until every client has switched, and the
 * list goes back to a single id afterwards.
 *
 * A token is never tried against each project in turn. Its `aud` claim names
 * the project that issued it; that project is looked up in the configured list
 * and the token is verified by that project's app alone -- which checks `aud`
 * and `iss` again, cryptographically. A token whose `aud` is not configured is
 * rejected without being verified against anything.
 *
 * ## Firestore lives in its own project setting
 *
 * The Firestore client is built from `FIRESTORE_PROJECT_ID`, never from the
 * Auth list. It used to be built from the Auth project id, which pointed every
 * session write at a project with no Firestore database in it: each
 * `POST /v1/sessions` failed with gRPC 5 NOT_FOUND on the first write. There is
 * deliberately no fallback from one setting to the other.
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

/** The named app that owns the Firestore client. */
const FIRESTORE_APP_NAME = "somnus-firestore";

/**
 * One named app per Auth project, keyed by the project id itself. Never the
 * default app: with several projects, and with tests that build this service
 * more than once per process under different configurations, a shared default
 * would let one project's id reuse another project's app.
 */
const authAppName = (projectId: string): string => `somnus-auth-${projectId}`;

/**
 * Reuse an app by name, or create it.
 *
 * Name-aware rather than "whichever app exists": NestJS can construct providers
 * more than once across test modules in one process, `initializeApp` throws on a
 * duplicate name, and with several apps in play "the first one" is no longer
 * necessarily the one being asked for.
 */
function appNamed(name: string, projectId: string): App {
  const existing = getApps().find((candidate) => candidate.name === name);
  if (existing) return existing;
  return initializeApp({ projectId }, name);
}

/** `FIREBASE_PROJECT_ID` as a list: comma-separated, trimmed, de-duplicated, order kept. */
export function parseAuthProjectIds(value: string): string[] {
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) throw new Error("FIREBASE_PROJECT_ID names no project");
  return [...new Set(ids)];
}

/**
 * The `aud` claim of a JWT, read WITHOUT verifying it -- only to choose which
 * project verifies the token. Anything malformed yields null and the token is
 * rejected. Never trusted on its own: the chosen project's verification checks
 * `aud` again, along with the signature.
 */
export function unverifiedAudience(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: unknown;
    };
    return typeof claims.aud === "string" ? claims.aud : null;
  } catch {
    return null;
  }
}

@Injectable()
export class FirebaseService {
  /** Auth client per accepted project id, in configuration order. */
  private readonly authClients: ReadonlyMap<string, Auth>;
  private readonly firestoreClient: Firestore;

  constructor(authProjectIds: string, firestoreProjectId: string) {
    const ids = parseAuthProjectIds(authProjectIds);
    const clients = new Map<string, Auth>();
    for (const id of ids) clients.set(id, getAuth(appNamed(authAppName(id), id)));
    this.authClients = clients;
    this.firestoreClient = getFirestore(appNamed(FIRESTORE_APP_NAME, firestoreProjectId));
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    const audience = unverifiedAudience(idToken);
    const client = audience === null ? undefined : this.authClients.get(audience);
    if (!client) throw new Error("ID token is not for an accepted Firebase project");
    return client.verifyIdToken(idToken, false);
  }

  get firestore(): Firestore {
    return this.firestoreClient;
  }
}
