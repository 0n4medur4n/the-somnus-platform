import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/infrastructure/db/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "mysql://root:rootpw@127.0.0.1:3306/somnus_identity",
  },
});
