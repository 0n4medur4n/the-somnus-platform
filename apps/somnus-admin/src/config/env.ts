import type { z } from "zod";
import { AdminEnvSchema } from "./env-schema.js";

export type AppEnv = z.infer<typeof AdminEnvSchema>;

/**
 * Local defaults live behind `import.meta.env.DEV`, so Vite removes the whole
 * branch from a production bundle.
 *
 * They used to be schema `.default()`s, which meant a build with no
 * configuration silently produced a console pointed at localhost instead of
 * failing -- and that is exactly what got deployed. Defaults that apply in a
 * real build are indistinguishable from a missing check.
 */
const defaults = import.meta.env.DEV
  ? {
      VITE_EDGE_API_URL: "http://localhost:8080",
      VITE_FIREBASE_API_KEY: "demo-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "somnus-dev-test.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "somnus-dev-test",
    }
  : {};

export const env: AppEnv = AdminEnvSchema.parse({ ...defaults, ...import.meta.env });
