import { z } from "zod";

/**
 * The Audit module's own database configuration (build plan §5.7 / ADR 0010): an
 * isolated logical database `somnus_audit`, separate from the Notification
 * module's. It normalizes and stores audit records; it must NOT become a copy of
 * every service database.
 */
export const AuditDbConfigSchema = z.object({
  AUDIT_DATABASE_URL: z.string().min(1).default("mysql://root:rootpw@127.0.0.1:3306/somnus_audit"),
  AUDIT_DB_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
  AUDIT_DB_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type AuditDbConfig = z.infer<typeof AuditDbConfigSchema>;

export function loadAuditDbConfig(env: NodeJS.ProcessEnv = process.env): AuditDbConfig {
  const result = AuditDbConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(
      `[audit-db-config] FATAL: invalid database configuration:\n${result.error.message}`,
    );
    process.exit(1);
  }
  return result.data;
}
