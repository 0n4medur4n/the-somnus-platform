import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["scripts/**/*.ts", "packages/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.config.ts", "**/types/**"],
    },
  },
});
