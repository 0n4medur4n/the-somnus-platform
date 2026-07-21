import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
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
