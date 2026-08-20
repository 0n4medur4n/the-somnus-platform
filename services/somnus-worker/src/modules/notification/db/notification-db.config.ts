import { z } from "zod";

/**
 * The Notification module's own database configuration (build plan §5.7 / ADR
 * 0010): an isolated logical database `somnus_notifications`, own connection, own
 * pool sizing. Local dev/CI point it at the same physical MySQL as the other
 * services, differing only in the database name; in every real environment it has
 * its own user and password, provisioned independently.
 */
export const NotificationDbConfigSchema = z.object({
  NOTIFICATIONS_DATABASE_URL: z
    .string()
    .min(1)
    .default("mysql://root:rootpw@127.0.0.1:3306/somnus_notifications"),
  NOTIFICATIONS_DB_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFICATIONS_DB_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type NotificationDbConfig = z.infer<typeof NotificationDbConfigSchema>;

export function loadNotificationDbConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationDbConfig {
  const result = NotificationDbConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(
      `[notification-db-config] FATAL: invalid database configuration:\n${result.error.message}`,
    );
    process.exit(1);
  }
  return result.data;
}
