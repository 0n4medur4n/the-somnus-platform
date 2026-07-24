import { defineConfig } from "drizzle-kit";

/**
 * Consent's own drizzle-kit config, separate from `drizzle.config.ts`:
 * a different schema, a different migrations folder, and a different
 * database (build plan §13 / ADR 0010 -- own logical database, own
 * independent migration history).
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/modules/consent/db/schema/index.ts",
  out: "./src/modules/consent/migrations",
  dbCredentials: {
    url: process.env["CONSENT_DATABASE_URL"] ?? "mysql://root:rootpw@127.0.0.1:3306/somnus_consent",
  },
});
