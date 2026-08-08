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
    // These integration tests run against a real MySQL/TiDB instance.
    // Locally that's docker-compose on localhost; in CI it's the TiDB
    // Cloud dev cluster in AWS eu-central-1, reached over the public
    // internet from a GitHub-hosted runner. That path adds real
    // round-trip latency, and TiDB Serverless scales to zero when idle
    // -- the first queries of a run pay a cold-start resume cost. A
    // multi-step test (the negative-auth org lifecycle, the HTTP
    // endpoint flows) does many sequential round-trips and can exceed
    // the 20s/10s defaults on a cold remote cluster even though every
    // assertion is correct. These generous ceilings are about the
    // network, not the logic; they never mask a hang, since a genuinely
    // stuck test still fails, just later. Raised to 120s after a 60s
    // timeout still tripped on an unusually cold cluster resume (TiDB
    // Serverless documents resume-from-idle taking up to ~a minute, and
    // a multi-step test spends that on top of its own round-trips).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Retry an integration test that fails against the remote cluster.
    // These tests are deterministic locally (docker-compose MySQL); the
    // flakiness is entirely the shared TiDB Serverless dev cluster
    // reached over the public internet from CI -- occasional connection
    // handshakes, throttling, and resume stalls that surface as a
    // timeout or a transient query error. A retry re-runs beforeEach
    // (resetTables) then the test, so it is idempotent; a genuine bug
    // still fails all attempts (and would fail locally too), so this
    // hides latency, never a real regression. Bumped 2 -> 3 after a run
    // where the consent database happened to be mid-scale-down for the
    // whole window of the first three attempts (a delete in resetTables
    // dropped, then two hook timeouts); a fourth attempt lands after the
    // serverless resume completes.
    retry: 3,
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
      include: [
        "src/infrastructure/db/repositories/**/*.ts",
        "src/domain/**/*.ts",
        "src/modules/consent/db/repositories/**/*.ts",
        "src/modules/consent/consent.service.ts",
      ],
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
        // Consent's repositories held to the same bar as identity's
        // (build plan §20 Checkpoint 6.1 precedent).
        "src/modules/consent/db/repositories/**": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 70,
        },
        // consent.service.ts is the module's entire public interface
        // (build plan ADR 0010) -- held to the same bar as the
        // authorization domain it feeds into.
        "src/modules/consent/consent.service.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
      },
    },
  },
});
