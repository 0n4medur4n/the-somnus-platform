import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { checkHostingBundle, checkHostingText } from "../../scripts/check-hosting-bundle.mjs";
import { HostingEnvSchema } from "./src/config/env-schema.js";

/**
 * The internal admin console: a static bundle on its OWN Firebase Hosting site
 * (Addendum A §A2.1), separate from the consumer SPA so it carries none of the
 * consumer bundle and can later be restricted (IP allowlist, SSO) without
 * touching somnus-app. It talks only to somnus-edge-api's `/admin/v1` surface.
 *
 * Distinct dev/preview ports from somnus-app (5173/4173) so both can run at
 * once; edge-api's CORS allow-list must include this origin.
 *
 * `--mode hosting-<env>` is what makes a build deployable, and it is the same
 * arrangement somnus-app uses. A plain `vite build` is a developer convenience
 * and is NOT safe to deploy: it loads local .env files, keeps source maps, and
 * emits no hosting-config.json, which is what the predeploy guard reads. Only
 * the hosting modes validate their configuration and scan their own output.
 */
export default defineConfig(({ mode }) => {
  const hosting = mode.startsWith("hosting-");
  const environment = mode.slice("hosting-".length);
  if (hosting && !["dev", "staging", "production"].includes(environment)) {
    throw new Error("Unknown Hosting environment");
  }
  const publicEnv: Record<string, string> = {};
  if (hosting) {
    // dev's values are committed (they are public identifiers, and the dev
    // Hosting deploy runs from ci.yml with no per-environment variables set).
    // staging and production supply everything through the environment, so a
    // missing variable fails here rather than silently inheriting dev's.
    const input: Record<string, string> =
      environment === "dev"
        ? JSON.parse(readFileSync(new URL("./hosting.dev.json", import.meta.url), "utf8"))
        : {};
    for (const key of Object.keys(HostingEnvSchema.shape)) {
      if (process.env[key] !== undefined) input[key] = process.env[key];
    }
    // The deploy workflow passes an empty string to mean "no emulator"; the
    // schema wants the key absent.
    if (input["VITE_AUTH_EMULATOR_URL"] === "") delete input["VITE_AUTH_EMULATOR_URL"];
    const result = HostingEnvSchema.safeParse(input);
    if (!result.success) {
      throw new Error(
        `Invalid Hosting configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
      );
    }
    for (const [key, value] of Object.entries(result.data)) {
      if (value !== undefined) publicEnv[key] = value;
    }
    checkHostingText(JSON.stringify(publicEnv), "Hosting configuration");
  }
  const guard: Plugin = {
    name: "somnus-admin-hosting-guard",
    generateBundle() {
      // Read back by scripts/check-hosting-bundle.mjs, both here and again as a
      // firebase.json predeploy -- so a bundle built somewhere else still cannot
      // reach the site without passing the same check.
      this.emitFile({
        type: "asset",
        fileName: "hosting-config.json",
        source: JSON.stringify({ environment, ...publicEnv }),
      });
    },
    async closeBundle() {
      await checkHostingBundle(fileURLToPath(new URL("./dist", import.meta.url)));
    },
  };
  return {
    // Real Hosting builds never load ignored local .env files.
    ...(hosting
      ? {
          envDir: false as const,
          define: {
            // src/config/env.ts keeps its local defaults behind `import.meta.env.DEV`
            // so they are dropped from a real bundle. Vite derives DEV from
            // NODE_ENV, which means an inherited `NODE_ENV=test` (a test runner, a
            // CI step that exports it) would leave that branch in and put
            // localhost:8080 back into a deployable artifact -- verified, not
            // theoretical. A hosting build is production by definition, so it says
            // so itself rather than trusting the ambient environment.
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            ...Object.fromEntries(
              Object.entries(publicEnv).map(([key, value]) => [
                `import.meta.env.${key}`,
                JSON.stringify(value),
              ]),
            ),
          },
        }
      : {}),
    plugins: [react(), tailwindcss(), ...(hosting ? [guard] : [])],
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
    build: { outDir: "dist", sourcemap: !hosting },
  };
});
