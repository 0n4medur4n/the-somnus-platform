import { Injectable } from "@nestjs/common";
import { UUIDv7 } from "@somnus/api-contracts";
import { Timestamp } from "firebase-admin/firestore";
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";

/** Firestore collection holding server-side sessions (build plan §9: short-lived session lookup). */
const SESSIONS_COLLECTION = "sessions";

export type SessionRecord = {
  sessionId: string;
  firebaseUid: string;
  email: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  // The resolved internal Somnus user id, memoized on first composition
  // request (build plan §20 Checkpoint 8.2). Null until resolved -- a
  // brand-new session has only the Firebase identity; edge-api asks
  // identity for the Somnus id once and caches it here.
  somnusUserId: string | null;
};

type SessionDoc = {
  firebaseUid: string;
  email: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  somnusUserId?: string | null;
};

/**
 * Server-side sessions, the mechanism behind edge-api's session cookie
 * (build plan §5.3 / §10 / ADR 0006). The cookie carries only an
 * opaque session id; all state lives here, in Firestore.
 *
 * Why a server-side store rather than Firebase's own session cookies:
 * the Firebase Auth emulator (the mandated Checkpoint 8.1 test target)
 * does not enforce refresh-token revocation, so
 * `verifySessionCookie(cookie, checkRevoked=true)` can never reject a
 * revoked session there. A server-side store makes revocation
 * immediate and absolute -- `revoke()` writes `revokedAt` and the very
 * next `validate()` fails -- with no dependency on Firebase's
 * revocation working. This is exactly ADR 0006's "revoking a user
 * means revoking the session, not waiting for a token to refresh."
 *
 * Edge-api has no TiDB connection (build plan §5.3), so this store
 * cannot be the identity database; Firestore is the §9-sanctioned
 * place for short-lived session lookup.
 */
@Injectable()
export class SessionService {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection() {
    return this.firebase.firestore.collection(SESSIONS_COLLECTION);
  }

  async create(input: {
    firebaseUid: string;
    email: string | null;
    ttlSeconds: number;
    now?: Date;
  }): Promise<SessionRecord> {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const sessionId = UUIDv7();
    const doc: SessionDoc = {
      firebaseUid: input.firebaseUid,
      email: input.email,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      revokedAt: null,
      somnusUserId: null,
    };
    await this.collection.doc(sessionId).set(doc);
    return {
      sessionId,
      firebaseUid: input.firebaseUid,
      email: input.email,
      createdAt: now,
      expiresAt,
      revokedAt: null,
      somnusUserId: null,
    };
  }

  /**
   * Memoize the resolved internal Somnus user id on the session
   * (build plan §20 Checkpoint 8.2). Idempotent: writing the same id
   * again is harmless. A no-op if the session no longer exists.
   */
  async setSomnusUserId(sessionId: string, somnusUserId: string): Promise<void> {
    const ref = this.collection.doc(sessionId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return;
    await ref.update({ somnusUserId });
  }

  /**
   * Returns the active session, or null if it is missing, revoked, or
   * expired. The single Firestore read here is the per-request
   * revocation + expiry check -- there is no cached copy to go stale.
   */
  async validate(sessionId: string, now: Date = new Date()): Promise<SessionRecord | null> {
    const snapshot = await this.collection.doc(sessionId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() as SessionDoc;
    if (data.revokedAt !== null) return null;
    const expiresAt = data.expiresAt.toDate();
    if (expiresAt.getTime() <= now.getTime()) return null;
    return {
      sessionId,
      firebaseUid: data.firebaseUid,
      email: data.email,
      createdAt: data.createdAt.toDate(),
      expiresAt,
      revokedAt: null,
      somnusUserId: data.somnusUserId ?? null,
    };
  }

  /**
   * Idempotent: revoking a missing or already-revoked session is a
   * no-op success. `DELETE /v1/sessions/current` clearing a cookie
   * whose session is already gone should not error.
   */
  async revoke(sessionId: string, now: Date = new Date()): Promise<void> {
    const ref = this.collection.doc(sessionId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return;
    const data = snapshot.data() as SessionDoc;
    if (data.revokedAt !== null) return;
    await ref.update({ revokedAt: Timestamp.fromDate(now) });
  }
}
