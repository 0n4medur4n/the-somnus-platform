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
    // Each frontend has its own vitest config. This runner is node and must
    // not sweep those suites (jsdom for the SPAs; Astro for marketing).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/somnus-app/**",
      "apps/somnus-admin/**",
      "apps/somnus-marketing/**",
      "apps/somnus-nox/**",
    ],
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
