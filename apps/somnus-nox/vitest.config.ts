import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { usesDevMock } from "./src/api/nox-me-mode.js";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@nox-me-source",
        replacement: fileURLToPath(
          new URL(
            usesDevMock(mode) ? "./src/api/nox-me.mock.ts" : "./src/api/nox-me.live.ts",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/api/nox-me.temporary.ts",
        "src/api/nox-me-mode.ts",
        "src/api/nox-me.live.ts",
        "src/api/load-nox-me.ts",
        "src/auth/auth-failure.ts",
        "src/auth/firebase-auth.ts",
        "src/auth/NoxAuthProvider.tsx",
        "src/config/env-schema.ts",
        "src/i18n/index.ts",
        "src/modules/registry.ts",
        "src/theme.ts",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
}));
