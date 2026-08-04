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
    // These integration tests run against the Firebase Auth + Firestore
    // emulators (build plan §10 / §9). Reaching them, plus firebase-admin
    // app init, is slower than an in-process unit test; the generous
    // ceilings are about that latency, not the logic. A genuinely stuck
    // test still fails, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    // The Firestore session store is shared state across test files;
    // sequential execution keeps one file's revocation test from racing
    // another's session reads.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/modules/sessions/**/*.ts",
        "src/infrastructure/firebase/**/*.ts",
        "src/modules/me/**/*.ts",
        "src/modules/consent/**/*.ts",
        "src/modules/registration/**/*.ts",
        "src/modules/organizations/**/*.ts",
        "src/infrastructure/internal-clients/**/*.ts",
        "src/common/composition.util.ts",
      ],
      // Module files are declarative DI wiring, exercised implicitly by
      // the integration boot; they carry no branch logic worth a bar.
      exclude: ["**/index.ts", "**/*.dto.ts", "**/*.decorator.ts", "**/*.module.ts"],
      thresholds: {
        // The session store + guard are edge-api's security core.
        // Local run: 100% stmts/funcs/lines, ~80% branches. The branch
        // bar is set a little under that (70) for the few points of
        // v8 branch-counting variance between platforms/Node builds.
        "src/modules/sessions/**": {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 70,
        },
        // The composition layer (BFF proxy + actor resolution).
        "src/modules/me/**": { lines: 85, functions: 85, statements: 85, branches: 70 },
        "src/modules/consent/**": { lines: 85, functions: 85, statements: 85, branches: 70 },
        "src/modules/registration/**": { lines: 85, functions: 85, statements: 85, branches: 70 },
        "src/modules/organizations/**": { lines: 85, functions: 85, statements: 85, branches: 70 },
        "src/infrastructure/internal-clients/**": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 60,
        },
      },
    },
  },
});
