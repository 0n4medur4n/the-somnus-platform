import type { z } from "zod";
import { AppEnvSchema } from "./env-schema.js";

export type AppEnv = z.infer<typeof AppEnvSchema>;

// Vite removes the entire local-default branch from production bundles.
const defaults = import.meta.env.DEV
  ? {
      VITE_EDGE_API_URL: "http://localhost:8080",
      VITE_FIREBASE_API_KEY: "demo-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "somnus-dev-test.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "somnus-dev-test",
    }
  : {};

export const env: AppEnv = AppEnvSchema.parse({ ...defaults, ...import.meta.env });
