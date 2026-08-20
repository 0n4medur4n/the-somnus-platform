import { Module } from "@nestjs/common";
import {
  createNotificationDb,
  createNotificationPool,
  type NotificationDb,
} from "./notification-db.client.js";
import { loadNotificationDbConfig } from "./notification-db.config.js";
import { DeliveriesRepository } from "./repositories/index.js";

export const NOTIFICATION_DB = Symbol("NOTIFICATION_DB");

/**
 * Deliberately NOT `@Global()`: this connection and repository are
 * notification-internal state. Only `NotificationModule` imports this module;
 * nothing outside `src/modules/notification/` may reach `NOTIFICATION_DB` or the
 * repository directly — other code reaches the module only through its public
 * `NotificationService` (build plan ADR 0010, isolated module).
 */
@Module({
  providers: [
    {
      provide: NOTIFICATION_DB,
      useFactory: (): NotificationDb => {
        const config = loadNotificationDbConfig(process.env);
        const pool = createNotificationPool(config);
        return createNotificationDb(pool);
      },
    },
    {
      provide: DeliveriesRepository,
      useFactory: (db: NotificationDb) => new DeliveriesRepository(db),
      inject: [NOTIFICATION_DB],
    },
  ],
  exports: [NOTIFICATION_DB, DeliveriesRepository],
})
export class NotificationDbModule {}
