import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // The console's logic layer: the edge client, the auth flow, and the
      // gate that decides between the console and the denial screen.
      // The Drive's cryptography and session are held to the same bar: they are
      // the whole of its security, so they are measured, not assumed.
      include: [
        "src/lib/**/*.ts",
        "src/auth/**/*.ts",
        "src/auth/**/*.tsx",
        "src/i18n/index.ts",
        "src/drive/*.ts",
      ],
      exclude: ["src/drive/fake-drive-server.ts", "src/**/*.test.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
