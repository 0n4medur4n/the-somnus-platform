import { z } from "zod";

/**
 * The Drive module's storage configuration (owner decision 2026-10-18, ADR
 * 0019): one private Cloud Storage bucket, reached with the worker's own
 * identity. No database and no credential.
 *
 * Unset in local development and tests, where the Drive keeps its objects in
 * memory. A production process without a bucket refuses Drive requests instead.
 */
export const DriveConfigSchema = z.object({
  DRIVE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/, "must be a bucket name")
    .optional(),
});

export type DriveConfig = z.infer<typeof DriveConfigSchema>;

export function loadDriveConfig(env: NodeJS.ProcessEnv = process.env): DriveConfig {
  const result = DriveConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[drive-config] FATAL: invalid configuration:
${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
