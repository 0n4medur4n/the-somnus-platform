import { z } from "zod";

/**
 * Retention-job configuration (build plan §5.7 / §12.2). The TTLs default to the
 * build-plan values (30-day unclaimed assessments, 72 h claim tokens) but are
 * overridable. MORPHEO_BASE_URL is the private morpheo service the worker calls to
 * perform the deletes (morpheo owns the data, §7).
 */
export const MaintenanceConfigSchema = z.object({
  MORPHEO_BASE_URL: z.string().default("http://127.0.0.1:8080"),
  UNCLAIMED_ASSESSMENT_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  CLAIM_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).default(72),
});

export type MaintenanceConfig = z.infer<typeof MaintenanceConfigSchema>;

export function loadMaintenanceConfig(env: NodeJS.ProcessEnv = process.env): MaintenanceConfig {
  const result = MaintenanceConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[maintenance-config] FATAL: invalid configuration:\n${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
