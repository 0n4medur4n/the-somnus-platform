import { Injectable } from "@nestjs/common";
import { UUIDv7 } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { Timestamp } from "firebase-admin/firestore";
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";
import { type SessionClient } from "./classify-session.js";

/** Firestore collection holding server-side sessions (build plan §9: short-lived session lookup). */
const SESSIONS_COLLECTION = "sessions";

/** Console idle limit (ADR 0027 decision 8). A web session does not use it. */
export const CONSOLE_IDLE_MS = 30 * 60 * 1000;

/** Console absolute limit, measured from `authTime`. It does not move. */
export const CONSOLE_ABSOLUTE_MS = 10 * 60 * 60 * 1000;

/**
 * A console request newer than this does not write `lastSeenAt` again.
 * The idle deadline stays on the older mark, so the session can end up to
 * this long before 30 minutes have passed since the last real request.
 */
export const LAST_SEEN_INTERVAL_MS = 60 * 1000;

export type ConsoleAccess = { ok: false } | { ok: true; writeLastSeen: boolean };

/**
 * Console session still inside both limits, and whether this request should
 * store a new `lastSeenAt`. Missing `authTime` fails closed. Missing
 * `lastSeenAt` measures idle from `authTime` and asks for a write.
 */
export function consoleAccess(
  now: Date,
  authTime: Date | undefined,
  lastSeenAt: Date | undefined,
): ConsoleAccess {
  if (authTime === undefined) return { ok: false };
  if (now.getTime() >= authTime.getTime() + CONSOLE_ABSOLUTE_MS) return { ok: false };
  const seen = lastSeenAt ?? authTime;
  if (now.getTime() >= seen.getTime() + CONSOLE_IDLE_MS) return { ok: false };
  const writeLastSeen =
    lastSeenAt === undefined || now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS;
  return { ok: true, writeLastSeen };
}

export type SessionRecord = {
  sessionId: string;
  firebaseUid: string;
  email: string | null;
  emailVerified?: boolean;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  // The resolved internal Somnus user id, memoized on first composition
  // request (build plan §20 Checkpoint 8.2). Null until resolved -- a
  // brand-new session has only the Firebase identity; edge-api asks
  // identity for the Somnus id once and caches it here.
  somnusUserId: string | null;
  /**
   * Recorded when the session is created. Absent on documents written
   * before that. A reader does not invent them and does not write them
   * back: a missing `client` is not an app session and not a console one.
   */
  client?: SessionClient;
  /** How the person signed in. `email_link` for the current sign-in route. */
  amr?: readonly string[];
  /** When that sign-in was verified. Not moved by a later read or by step-up. */
  authTime?: Date;
  /** Null until a step-up is recorded. Absent on older documents. */
  stepUpAt?: Date | null;
  /**
   * Last console request that was allowed to move the idle window.
   * Absent on web sessions and on documents written before this field.
   */
  lastSeenAt?: Date;
};

type SessionDoc = {
  firebaseUid: string;
  email: string | null;
  emailVerified?: boolean;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  somnusUserId?: string | null;
  client?: SessionClient;
  amr?: string[];
  authTime?: Timestamp;
  stepUpAt?: Timestamp | null;
  lastSeenAt?: Timestamp;
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
    emailVerified?: boolean;
    ttlSeconds: number;
    now?: Date;
    client: SessionClient;
    amr: readonly string[];
    authTime: Date;
    stepUpAt: Date | null;
  }): Promise<SessionRecord> {
    const now = input.now ?? new Date();
    // A console token whose auth_time is already 10 hours old would be stored
    // with an expiresAt in the past and fail on its first request. Refuse
    // before the write. The message stays the generic unauthenticated one.
    if (
      input.client === "console" &&
      now.getTime() >= input.authTime.getTime() + CONSOLE_ABSOLUTE_MS
    ) {
      throw new SomnusError(ErrorCode.UNAUTHENTICATED, "Authentication is required.", {
        correlationId: "sessions",
      });
    }
    const ttlEnd = new Date(now.getTime() + input.ttlSeconds * 1000);
    const absoluteEnd =
      input.client === "console" ? new Date(input.authTime.getTime() + CONSOLE_ABSOLUTE_MS) : null;
    const expiresAt =
      absoluteEnd !== null && absoluteEnd.getTime() < ttlEnd.getTime() ? absoluteEnd : ttlEnd;
    const sessionId = UUIDv7();
    const amr = [...input.amr];
    const doc: SessionDoc = {
      firebaseUid: input.firebaseUid,
      email: input.email,
      ...(input.emailVerified === undefined ? {} : { emailVerified: input.emailVerified }),
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      revokedAt: null,
      somnusUserId: null,
      client: input.client,
      amr,
      authTime: Timestamp.fromDate(input.authTime),
      stepUpAt: input.stepUpAt === null ? null : Timestamp.fromDate(input.stepUpAt),
      ...(input.client === "console" ? { lastSeenAt: Timestamp.fromDate(now) } : {}),
    };
    await this.collection.doc(sessionId).set(doc);
    return {
      sessionId,
      firebaseUid: input.firebaseUid,
      email: input.email,
      ...(input.emailVerified === undefined ? {} : { emailVerified: input.emailVerified }),
      createdAt: now,
      expiresAt,
      revokedAt: null,
      somnusUserId: null,
      client: input.client,
      amr,
      authTime: input.authTime,
      stepUpAt: input.stepUpAt,
      ...(input.client === "console" ? { lastSeenAt: now } : {}),
    };
  }

  /**
   * Memoize the resolved internal Somnus user id on the session
   * (build plan §20 Checkpoint 8.2). Idempotent: writing the same id
   * again is harmless. A no-op if the session no longer exists. The
   * update names only `somnusUserId`, so client, amr, authTime and
   * stepUpAt stay as they were written at creation.
   */
  async setSomnusUserId(sessionId: string, somnusUserId: string): Promise<void> {
    const ref = this.collection.doc(sessionId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return;
    await ref.update({ somnusUserId });
  }

  /**
   * Returns the active session, or null if it is missing, revoked, or
   * expired. A console session is also null once it has been idle for 30
   * minutes or once `authTime` is 10 hours old. A web session is not.
   * The only write is `lastSeenAt`, and only for a console session that
   * is still allowed, and at most once a minute.
   */
  async validate(sessionId: string, now: Date = new Date()): Promise<SessionRecord | null> {
    const snapshot = await this.collection.doc(sessionId).get();
    if (!snapshot.exists) return null;
    const raw = snapshot.data() as Record<string, unknown>;
    const data = raw as SessionDoc;
    if (data.revokedAt !== null) return null;
    const expiresAt = data.expiresAt.toDate();
    if (expiresAt.getTime() <= now.getTime()) return null;
    // Older documents have none of these. A value that is not the shape
    // written at creation is ignored. A missing `client` stays missing:
    // it is not treated as console.
    const client = recordedClient(raw["client"]);
    const amr = recordedAmr(raw["amr"]);
    const authTime = recordedTime(raw["authTime"]);
    const stepUpAt = recordedStepUp(raw["stepUpAt"]);
    const storedLastSeen = recordedTime(raw["lastSeenAt"]);
    let lastSeenAt = storedLastSeen;
    if (client === "console") {
      const access = consoleAccess(now, authTime, storedLastSeen);
      if (!access.ok) return null;
      if (access.writeLastSeen) {
        lastSeenAt = now;
        await this.collection.doc(sessionId).update({ lastSeenAt: Timestamp.fromDate(now) });
      }
    }
    return {
      sessionId,
      firebaseUid: data.firebaseUid,
      email: data.email,
      ...(data.emailVerified === undefined ? {} : { emailVerified: data.emailVerified }),
      createdAt: data.createdAt.toDate(),
      expiresAt,
      revokedAt: null,
      somnusUserId: data.somnusUserId ?? null,
      ...(client === undefined ? {} : { client }),
      ...(amr === undefined ? {} : { amr }),
      ...(authTime === undefined ? {} : { authTime }),
      ...(stepUpAt === undefined ? {} : { stepUpAt }),
      ...(client === "console" && lastSeenAt !== undefined ? { lastSeenAt } : {}),
    };
  }

  /**
   * Account deletion: everything this service holds about how the person signs in.
   * Deletes every session document of the account (not just the current one, and
   * not merely marked revoked: they hold the email) and then the Firebase
   * Authentication account itself. Both are tried even if the first fails, and the
   * first failure is raised, so a failure is never silent and never halves the work.
   */
  async eraseSignInIdentity(firebaseUid: string): Promise<void> {
    let failure: unknown;
    try {
      const sessions = await this.collection.where("firebaseUid", "==", firebaseUid).get();
      await Promise.all(sessions.docs.map((doc) => doc.ref.delete()));
    } catch (error) {
      failure = error;
    }
    try {
      await this.firebase.deleteUser(firebaseUid);
    } catch (error) {
      failure = failure ?? error;
    }
    if (failure !== undefined) throw failure;
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

function recordedClient(value: unknown): SessionClient | undefined {
  if (value === "console" || value === "app") return value;
  return undefined;
}

function recordedAmr(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const amr: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    amr.push(entry);
  }
  return amr;
}

function recordedTime(value: unknown): Date | undefined {
  if (value instanceof Timestamp) return value.toDate();
  return undefined;
}

/** Null is a recorded "no step-up". Absent stays absent. Anything else is ignored. */
function recordedStepUp(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Timestamp) return value.toDate();
  return undefined;
}
