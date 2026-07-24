import { z } from "zod";

/**
 * Deliberately separate from `../../infrastructure/db/db.config.ts`'s
 * DbConfigSchema, not a reused/prefixed variant of it: build plan §13
 * / ADR 0010 require the consent module's database to be genuinely
 * independent (own logical database, own connection, own pool
 * sizing), not merely a different database name reached through
 * identity's existing pool.
 *
 * Local dev and this repo's current CI both point CONSENT_DATABASE_URL
 * at the same physical MySQL/TiDB cluster as identity's, differing
 * only in the database name (`somnus_consent` vs `somnus_identity`) --
 * that is a dev/CI cost simplification, not the production shape. In
 * every real environment (build plan §8), `somnus_consent` has its own
 * database user and password, provisioned independently of identity's.
 */
export const ConsentDbConfigSchema = z.object({
  CONSENT_DATABASE_URL: z
    .string()
    .min(1)
    .default("mysql://root:rootpw@127.0.0.1:3306/somnus_consent"),
  CONSENT_DB_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
  CONSENT_DB_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type ConsentDbConfig = z.infer<typeof ConsentDbConfigSchema>;

export function loadConsentDbConfig(env: NodeJS.ProcessEnv = process.env): ConsentDbConfig {
  const result = ConsentDbConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(
      `[consent-db-config] FATAL: invalid database configuration:\n${result.error.message}`,
    );
    process.exit(1);
  }
  return result.data;
}
