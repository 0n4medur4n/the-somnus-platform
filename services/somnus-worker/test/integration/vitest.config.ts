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
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    // Real MySQL, one shared instance: no file parallelism (build plan §19).
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/modules/notification/db/repositories/**/*.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
