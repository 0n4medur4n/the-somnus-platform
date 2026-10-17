import { z } from "zod";

/**
 * The Drive module's own database configuration (owner decision 2026-10-17,
 * ADR 0019): an isolated logical database `somnus_drive`, separate from the
 * Notification and Audit modules' (ADR 0010).
 *
 * It holds ciphertext, public keys and folder membership -- never a key that
 * opens anything. A dump of this database is a dump of sealed boxes.
 */
export const DriveDbConfigSchema = z.object({
  DRIVE_DATABASE_URL: z.string().min(1).default("mysql://root:rootpw@127.0.0.1:3306/somnus_drive"),
  DRIVE_DB_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(3),
  DRIVE_DB_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type DriveDbConfig = z.infer<typeof DriveDbConfigSchema>;

export function loadDriveDbConfig(env: NodeJS.ProcessEnv = process.env): DriveDbConfig {
  const result = DriveDbConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(
      `[drive-db-config] FATAL: invalid database configuration:\n${result.error.message}`,
    );
    process.exit(1);
  }
  return result.data;
}
