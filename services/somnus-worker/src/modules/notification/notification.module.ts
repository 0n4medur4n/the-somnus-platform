import { Module } from "@nestjs/common";
import { NotificationDbModule } from "./db/notification-db.module.js";
import { DeliveriesRepository } from "./db/repositories/index.js";
import { BrevoClient, type EmailProvider } from "./delivery/brevo.client.js";
import { loadNotificationConfig } from "./notification.config.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

/**
 * The isolated Notification module (build plan §5.7 / ADR 0010). Owns its
 * database (via NotificationDbModule) and its provider; the outside world reaches
 * it only through NotificationService, which is what this module exports.
 */
@Module({
  imports: [NotificationDbModule],
  controllers: [NotificationController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: (): EmailProvider => {
        const config = loadNotificationConfig(process.env);
        return new BrevoClient(config.BREVO_API_KEY, {
          email: config.BREVO_SENDER_EMAIL,
          name: config.BREVO_SENDER_NAME,
        });
      },
    },
    {
      provide: NotificationService,
      useFactory: (deliveries: DeliveriesRepository, provider: EmailProvider) =>
        new NotificationService(deliveries, provider),
      inject: [DeliveriesRepository, EMAIL_PROVIDER],
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
