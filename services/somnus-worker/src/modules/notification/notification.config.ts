import { z } from "zod";

/**
 * Notification delivery configuration (build plan §3.7). BREVO_API_KEY is a
 * secret, injected in staging/production and empty locally (the provider is
 * mocked in every test, so the real Brevo API is never hit without a key).
 * CLOUD_TASKS_AUTH_TOKEN, when set, is the bearer the Cloud Tasks OIDC/push must
 * present; empty in local dev.
 */
export const NotificationConfigSchema = z.object({
  BREVO_API_KEY: z.string().default(""),
  BREVO_SENDER_EMAIL: z.string().email().default("no-reply@somnus.example"),
  BREVO_SENDER_NAME: z.string().min(1).default("The Somnus"),
  CLOUD_TASKS_AUTH_TOKEN: z.string().default(""),
  // How long a delivery record (it holds the recipient's email) is kept: the log
  // is for diagnosing a failed send, which is a matter of days, not of years.
  NOTIFICATION_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
});

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

export function loadNotificationConfig(env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  const result = NotificationConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[notification-config] FATAL: invalid configuration:\n${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
