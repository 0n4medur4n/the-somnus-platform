import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { usesDevMock } from "./src/api/nox-me-mode.js";

/**
 * The mock is opt-in: only Vite's development server and the test runner.
 * Every other mode (production, staging, an unset mode) resolves the live
 * GET /nox/v1/me. src/production-bundle.test.ts builds staging and a build
 * with no --mode and checks the bundles for the mock and the preview bypass.
 */
function noxMeSource(mode: string): string {
  const file = usesDevMock(mode) ? "nox-me.mock.ts" : "nox-me.live.ts";
  return fileURLToPath(new URL(`./src/api/${file}`, import.meta.url));
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: "@nox-me-source", replacement: noxMeSource(mode) }],
  },
  server: { port: 5175, strictPort: true },
  preview: { port: 4175, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
}));
