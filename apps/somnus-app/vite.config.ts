import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { checkHostingBundle, checkHostingText } from "../../scripts/check-hosting-bundle.mjs";
import { HostingEnvSchema } from "./src/config/env-schema.js";

// The SPA is a static bundle deployed to Firebase Hosting; it talks only
// to somnus-edge-api (build plan §5.2). Dev/preview ports match the
// origins edge-api's CORS allow-list already trusts (5173 / 4173).
export default defineConfig(({ mode }) => {
  const hosting = mode.startsWith("hosting-");
  const environment = mode.slice("hosting-".length);
  if (hosting && !["dev", "staging", "production"].includes(environment)) {
    throw new Error("Unknown Hosting environment");
  }
  const publicEnv: Record<string, string> = {};
  if (hosting) {
    const input: Record<string, string> =
      environment === "dev"
        ? JSON.parse(readFileSync(new URL("./hosting.dev.json", import.meta.url), "utf8"))
        : {};
    for (const key of Object.keys(HostingEnvSchema.shape)) {
      if (process.env[key] !== undefined) input[key] = process.env[key];
    }
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
    name: "somnus-hosting-guard",
    generateBundle() {
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
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { outDir: "dist", sourcemap: !hosting },
  };
});
