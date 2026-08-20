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
    // The default suite is DB-free (units + app-boot e2e). Integration tests that
    // need MySQL live under test/integration with their own config + global-setup.
    include: ["test/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // The shell's testable surface. main.ts (bootstrap) and DI wiring
      // (*.module.ts) are exercised by the app boot e2e but excluded from
      // thresholds; the exception filter is a faithful clone of identity's
      // (fully covered there) and is exercised end-to-end from Stage 3.
      include: [
        "src/modules/health/health.controller.ts",
        "src/modules/version/version.controller.ts",
        "src/common/interceptors/correlation.interceptor.ts",
        "src/modules/notification/notification.service.ts",
        "src/modules/notification/notification.controller.ts",
        "src/modules/notification/cloud-tasks-auth.guard.ts",
        "src/modules/notification/templates/render.ts",
        "src/modules/notification/delivery/brevo.client.ts",
        "src/modules/audit/audit.service.ts",
        "src/modules/audit/audit.controller.ts",
        "src/common/guards/internal-auth.guard.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
