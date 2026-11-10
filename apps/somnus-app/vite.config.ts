import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { checkHostingBundle, checkHostingText } from "../../scripts/check-hosting-bundle.mjs";
import { HostingEnvSchema, SAME_ORIGIN } from "./src/config/env-schema.js";

/**
 * End-to-end only (E2E_SECURITY_HEADERS=1): `vite preview` answers with the
 * headers firebase.json gives the app's "**" rule, so the Playwright suite runs
 * the production bundle under the production Content-Security-Policy and fails
 * on any violation. The one change is connect-src: the suite talks to a local
 * edge-api and Auth emulator instead of the real endpoints.
 */
function e2eSecurityHeaders(): Plugin {
  const config = JSON.parse(
    readFileSync(new URL("../../firebase.json", import.meta.url), "utf8"),
  ) as {
    hosting: Array<{
      target: string;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    }>;
  };
  const rule = config.hosting
    .find((site) => site.target === "app")
    ?.headers.find((entry) => entry.source === "**");
  if (!rule) throw new Error("firebase.json: the app has no ** header rule");
  const local = [process.env["VITE_EDGE_API_URL"], process.env["VITE_AUTH_EMULATOR_URL"]]
    .filter((value): value is string => Boolean(value) && value !== SAME_ORIGIN)
    .map((value) => new URL(value).origin);
  return {
    name: "somnus-e2e-security-headers",
    configurePreviewServer(server) {
      server.middlewares.use((_request, response, next) => {
        for (const { key, value } of rule.headers) {
          response.setHeader(
            key,
            key.toLowerCase() === "content-security-policy"
              ? value.replace("connect-src ", `connect-src ${local.join(" ")} `)
              : value,
          );
        }
        next();
      });
    },
  };
}

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
    plugins: [
      react(),
      tailwindcss(),
      ...(hosting ? [guard] : []),
      ...(process.env["E2E_SECURITY_HEADERS"] === "1" ? [e2eSecurityHeaders()] : []),
    ],
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { outDir: "dist", sourcemap: !hosting },
  };
});
