import type { z } from "zod";
import { AppEnvSchema } from "./env-schema.js";

export type AppEnv = z.infer<typeof AppEnvSchema>;

const defaults = import.meta.env.DEV
  ? {
      VITE_FIREBASE_API_KEY: "demo-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "somnus-dev-test.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "somnus-dev-test",
    }
  : {};

const raw: Record<string, unknown> = { ...defaults, ...import.meta.env };
if (raw["VITE_AUTH_EMULATOR_URL"] === "") delete raw["VITE_AUTH_EMULATOR_URL"];

export const env: AppEnv = AppEnvSchema.parse(raw);
