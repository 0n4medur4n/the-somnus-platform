import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { StaffInvitation, SupportedLocale } from "@somnus/api-contracts";
import { loadEdgeConfig } from "../../config/edge-config.js";
import { FirebaseService } from "../../infrastructure/firebase/firebase.service.js";
import {
  NOTIFICATION_QUEUE,
  type NotificationQueue,
} from "../../infrastructure/notification-queue/notification-queue.js";
import { cleanSignInLink } from "../auth-email-link/sign-in-link.js";

/**
 * Who the invitation email says is inviting. The `invitation` template reads
 * "...to join {{organizationName}}", so this is the staff team's name.
 */
const TEAM_NAME: Record<SupportedLocale, string> = {
  es: "The Somnus (equipo interno)",
  en: "The Somnus (staff)",
  ca: "The Somnus (equip intern)",
  fr: "The Somnus (équipe interne)",
};

/**
 * Sends a staff invitation (owner decision 2026-10-18). The link in the email
 * IS a console sign-in link for the invited address, so one click signs the
 * person in and the console shows them the invitation to accept. If the link
 * has lapsed by the time they click, signing in from the console as usual
 * reaches the same screen: the invitation is bound to the address, not the link.
 */
@Injectable()
export class StaffInvitationEmailService {
  private readonly consoleCallback = loadEdgeConfig(process.env).SIGN_IN_CONSOLE_CALLBACK_URL;

  constructor(
    private readonly firebase: FirebaseService,
    @Inject(NOTIFICATION_QUEUE) private readonly notifications: NotificationQueue,
  ) {}

  /** True when the email was queued; false (never a throw) when it was not. */
  async send(invitation: StaffInvitation, correlationId: string): Promise<boolean> {
    try {
      const generated = await this.firebase.generateSignInLink(
        invitation.email,
        this.consoleCallback,
      );
      const link = cleanSignInLink(generated, this.consoleCallback, invitation.locale);
      await this.notifications.enqueue(
        {
          idempotencyKey: `staff-invitation:${invitation.id}:${randomUUID()}`,
          type: "invitation",
          to: invitation.email,
          locale: invitation.locale,
          link,
          params: { organizationName: TEAM_NAME[invitation.locale] },
        },
        correlationId,
      );
      return true;
    } catch {
      // The invitation is saved either way; the console offers to resend.
      return false;
    }
  }
}
