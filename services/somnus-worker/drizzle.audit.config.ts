import { defineConfig } from "drizzle-kit";

/**
 * The Audit module's drizzle-kit config (build plan §5.7 / ADR 0010): its own
 * schema, its own migrations folder, its own database `somnus_audit` with an
 * independent migration history.
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/modules/audit/db/schema/index.ts",
  out: "./src/modules/audit/migrations",
  dbCredentials: {
    url: process.env["AUDIT_DATABASE_URL"] ?? "mysql://root:rootpw@127.0.0.1:3306/somnus_audit",
  },
});
