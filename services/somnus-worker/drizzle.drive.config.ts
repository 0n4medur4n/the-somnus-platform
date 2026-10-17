import { defineConfig } from "drizzle-kit";

/**
 * The Drive module's drizzle-kit config (ADR 0019 / ADR 0010): its own schema,
 * its own migrations folder, its own database `somnus_drive` with an independent
 * migration history.
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/modules/drive/db/schema/index.ts",
  out: "./src/modules/drive/migrations",
  dbCredentials: {
    url: process.env["DRIVE_DATABASE_URL"] ?? "mysql://root:rootpw@127.0.0.1:3306/somnus_drive",
  },
});
