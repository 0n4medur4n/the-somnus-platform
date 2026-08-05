import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // The logic layer the SPA is judged on: auth flow, the edge-api
      // client, and i18n wiring. Route rendering and the accessibility
      // baseline are exercised end-to-end by Playwright (not v8-
      // instrumented), the same way backend module wiring is excluded.
      include: [
        "src/lib/**/*.ts",
        "src/auth/AuthProvider.tsx",
        "src/auth/firebase-auth.ts",
        "src/auth/useAuth.ts",
        "src/i18n/index.ts",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
