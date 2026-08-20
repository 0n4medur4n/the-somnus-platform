import { defineConfig } from "drizzle-kit";

/**
 * The Notification module's drizzle-kit config (build plan §5.7 / ADR 0010): its
 * own schema, its own migrations folder, its own database `somnus_notifications`
 * with an independent migration history.
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/modules/notification/db/schema/index.ts",
  out: "./src/modules/notification/migrations",
  dbCredentials: {
    url:
      process.env["NOTIFICATIONS_DATABASE_URL"] ??
      "mysql://root:rootpw@127.0.0.1:3306/somnus_notifications",
  },
});
