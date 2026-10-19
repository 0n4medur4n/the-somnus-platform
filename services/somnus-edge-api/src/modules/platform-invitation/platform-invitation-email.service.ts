import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PlatformInvitation } from "@somnus/api-contracts";
import { loadEdgeConfig } from "../../config/edge-config.js";
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";
import {
  NOTIFICATION_QUEUE,
  type NotificationQueue,
} from "../../infrastructure/notification-queue/notification-queue.js";
import { cleanSignInLink } from "../auth-email-link/sign-in-link.js";
@Injectable()
export class PlatformInvitationEmailService {
  constructor(
    private readonly firebase: FirebaseService,
    @Inject(NOTIFICATION_QUEUE) private readonly notifications: NotificationQueue,
  ) {}
  async send(invitation: PlatformInvitation, correlationId: string): Promise<boolean> {
    try {
      const callback = loadEdgeConfig(process.env).SIGN_IN_CALLBACK_URL;
      const generated = await this.firebase.generateSignInLink(invitation.email, callback);
      const link = new URL(cleanSignInLink(generated, callback, invitation.locale));
      link.searchParams.set("platformInvitation", invitation.id);
      await this.notifications.enqueue(
        {
          idempotencyKey: `platform-invitation:${invitation.id}:${randomUUID()}`,
          type: "invitation",
          to: invitation.email,
          locale: invitation.locale,
          link: link.toString(),
          params: { organizationName: "Morpheo" },
        },
        correlationId,
      );
      return true;
    } catch {
      return false;
    }
  }
}
