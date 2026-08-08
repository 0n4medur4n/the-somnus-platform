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
    // The two frontend apps each have their own vitest config and CI job;
    // the node-environment root runner must not sweep their tests
    // (somnus-app is jsdom; somnus-marketing runs astro check + its own
    // suite, and its source is intentionally not touched by the root gate).
    exclude: ["**/node_modules/**", "**/dist/**", "apps/somnus-app/**", "apps/somnus-marketing/**"],
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
