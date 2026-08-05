import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // apps/somnus-app is a jsdom React app with its own vitest config and
    // CI job (setup files, jsdom environment); the node-environment root
    // runner must not sweep its browser-oriented tests.
    exclude: ["**/node_modules/**", "**/dist/**", "apps/somnus-app/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["scripts/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.config.ts",
        "**/types/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/index.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
        perFile: false,
      },
    },
  },
});
