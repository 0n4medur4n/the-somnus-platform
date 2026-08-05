import { defineConfig, devices } from "@playwright/test";

const APP_URL = process.env["E2E_APP_URL"] ?? "http://localhost:5173";

/**
 * Golden-path E2E (build plan §19 / §20 Checkpoint 9.1). Playwright
 * serves the SPA via the Vite dev server (so VITE_* env is read at
 * runtime). The backend stack -- Firebase Auth + Firestore emulators,
 * the identity service, and edge-api -- must already be running; see
 * tests/e2e/README.md and scripts/e2e-stack.mjs. In CI the somnus-app
 * E2E job starts that stack before invoking this config.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @somnus/app dev",
    url: APP_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    env: {
      VITE_EDGE_API_URL: process.env["VITE_EDGE_API_URL"] ?? "http://localhost:8080",
      VITE_AUTH_EMULATOR_URL: process.env["VITE_AUTH_EMULATOR_URL"] ?? "http://127.0.0.1:9099",
      VITE_FIREBASE_PROJECT_ID: process.env["VITE_FIREBASE_PROJECT_ID"] ?? "somnus-dev-test",
    },
  },
});
