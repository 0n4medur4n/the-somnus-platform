import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { SignInLinkRequest } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { Timestamp } from "firebase-admin/firestore";
import { correlationOf } from "../../common/composition.util.js";
import { loadEdgeConfig } from "../../config/edge-config.js";
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";
import { WORKER_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { cleanSignInLink, SAME_ADDRESS_INTERVAL_MS, throttleKey } from "./sign-in-link.js";

/** Firestore: one document per address hash, holding when a link was last sent. */
const THROTTLE_COLLECTION = "sign_in_link_throttle";

export type SignInLinkOutcome = "sent" | "throttled";

/**
 * Sends the passwordless sign-in link from The Somnus's own domain (Brevo,
 * through the worker's Notification module) instead of Firebase's shared one.
 *
 * Firebase still creates and validates the one-time code; this only changes who
 * delivers it and what the link looks like. Nothing here reveals whether an
 * account exists for the address: every request gets the same answer.
 */
@Injectable()
export class AuthEmailLinkService {
  private readonly callbacks = (() => {
    const config = loadEdgeConfig(process.env);
    return { app: config.SIGN_IN_CALLBACK_URL, console: config.SIGN_IN_CONSOLE_CALLBACK_URL };
  })();

  constructor(
    private readonly firebase: FirebaseService,
    @Inject(WORKER_CLIENT) private readonly worker: CloudRunClient,
  ) {}

  async send(request: SignInLinkRequest, rawCorrelationId?: string): Promise<SignInLinkOutcome> {
    const correlationId = correlationOf(rawCorrelationId);

    // One link per address per minute, whatever IP asks: no one can flood
    // somebody else's inbox. A throttled request is answered like any other.
    if (!(await this.claimSendSlot(request.email))) return "throttled";

    // Only our two configured callbacks: the client picks which, never the URL.
    const callbackUrl = this.callbacks[request.client];
    let link: string;
    try {
      const generated = await this.firebase.generateSignInLink(request.email, callbackUrl);
      link = cleanSignInLink(generated, callbackUrl, request.locale);
    } catch {
      throw new SomnusError(ErrorCode.UPSTREAM_UNAVAILABLE, "Could not create a sign-in link.", {
        correlationId,
      });
    }

    await this.worker.post("/internal/v1/notifications/tasks", {
      correlationId,
      body: {
        idempotencyKey: `sign-in-link:${randomUUID()}`,
        type: "sign_in_link",
        to: request.email,
        locale: request.locale,
        link,
        params: {},
      },
    });
    return "sent";
  }

  /** True when a link may go out now (and records that it does). */
  private async claimSendSlot(email: string): Promise<boolean> {
    const ref = this.firebase.firestore.collection(THROTTLE_COLLECTION).doc(throttleKey(email));
    return this.firebase.firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const last = snapshot.exists
        ? (snapshot.get("lastSentAt") as Timestamp | undefined)?.toMillis()
        : undefined;
      if (last !== undefined && Date.now() - last < SAME_ADDRESS_INTERVAL_MS) return false;
      tx.set(ref, { lastSentAt: Timestamp.now() });
      return true;
    });
  }
}
