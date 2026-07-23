import { z } from "zod";

/**
 * Validated at startup, failing fast on invalid config (build plan §20
 * Checkpoint 2.1 pattern). Kept separate from `@somnus/config`'s
 * SomnusConfigSchema: DATABASE_URL is service-specific, not part of
 * the shared base schema every service carries.
 */
export const DbConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).default("mysql://root:rootpw@127.0.0.1:3306/somnus_identity"),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
  // z.coerce.boolean() treats any non-empty string (including "false") as
  // true -- an enum + explicit transform avoids that footgun for env vars.
  DB_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type DbConfig = z.infer<typeof DbConfigSchema>;

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const result = DbConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[db-config] FATAL: invalid database configuration:\n${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
