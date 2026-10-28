import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Dev and tests resolve the /nox/v1/me client to the local mock.
 * A production build resolves it to the live fetch. The mock file is
 * not part of that module graph; src/production-bundle.test.ts checks
 * the built files for the mock sentinel.
 */
function noxMeSource(mode: string): string {
  const file = mode === "production" ? "nox-me.live.ts" : "nox-me.mock.ts";
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
