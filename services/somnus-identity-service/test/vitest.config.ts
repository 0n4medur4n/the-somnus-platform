import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true, dynamicImport: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 20_000,
    pool: "forks",
    // Integration tests share one real MySQL instance (build plan §19);
    // running files in parallel would let the migration up/down test's
    // DROP TABLE step race against repository tests reading those same
    // tables. Sequential execution costs a couple of seconds and buys
    // correctness.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/infrastructure/db/repositories/**/*.ts", "src/domain/**/*.ts"],
      exclude: ["**/index.ts"],
      thresholds: {
        // Build plan §20 Checkpoint 6.1: ≥80% on repositories.
        "src/infrastructure/db/repositories/**": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 70,
        },
        // Build plan §20 Checkpoint 6.2: ≥90% on authorization domain code.
        "src/domain/**": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
      },
    },
  },
});
