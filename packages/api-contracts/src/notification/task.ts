import { z } from "zod";
import { LocaleSchema } from "../locale.js";

/**
 * The notification task the worker consumes off Cloud Tasks (build plan §5.7 /
 * §3.7). TS↔TS boundary (an enqueuer in identity/edge -> the worker), so the Zod
 * schema is the shared contract; no JSON-Schema artifact is needed.
 *
 * A task carries ONLY what a template needs: a recipient, a locale, a secure
 * link, and non-clinical display params. It must NEVER carry health data,
 * assessment content, or an L-level — emails carry secure links, never health
 * details. The worker's template test asserts the rendered body stays clean.
 */

export const NOTIFICATION_TYPES = ["invitation", "report_ready"] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationTaskSchema = z
  .object({
    // Dedupe key: the same task delivered twice is processed once.
    idempotencyKey: z.string().min(1).max(200),
    type: NotificationTypeSchema,
    to: z.string().email(),
    locale: LocaleSchema,
    // A secure application link (accept/claim/download); never a health payload.
    link: z.string().url(),
    // Non-clinical display params only (e.g. organizationName, inviterName).
    params: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type NotificationTask = z.infer<typeof NotificationTaskSchema>;
