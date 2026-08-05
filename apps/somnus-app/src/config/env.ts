import { z } from "zod";

/**
 * Client configuration, all via Vite `VITE_*` env vars (never secrets:
 * build plan §5.2 — nothing sensitive lives in the browser). The
 * Firebase web config values are public identifiers, not credentials.
 * Defaults target the local emulator + docker stack so `pnpm dev` and
 * the E2E run work with no .env file.
 */
const EnvSchema = z.object({
  VITE_EDGE_API_URL: z.string().url().default("http://localhost:8080"),
  VITE_FIREBASE_API_KEY: z.string().min(1).default("demo-api-key"),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1).default("somnus-dev-test.firebaseapp.com"),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1).default("somnus-dev-test"),
  // When set (dev / E2E), the client points Firebase Auth at the local
  // emulator instead of real Firebase, e.g. "http://127.0.0.1:9099".
  VITE_AUTH_EMULATOR_URL: z.string().url().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const env: AppEnv = EnvSchema.parse(import.meta.env);
