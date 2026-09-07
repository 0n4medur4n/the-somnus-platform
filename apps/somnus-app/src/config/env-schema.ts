import { z } from "zod";

export const AppEnvSchema = z.object({
  VITE_EDGE_API_URL: z.url(),
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_AUTH_EMULATOR_URL: z.url().optional(),
});

export const HostingEnvSchema = AppEnvSchema.extend({
  VITE_EDGE_API_URL: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }),
  VITE_FIREBASE_API_KEY: z.string().regex(/^AIza[\w-]{35}$/),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().regex(/^[a-z0-9-]+\.firebaseapp\.com$/),
  VITE_FIREBASE_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]+$/),
  VITE_AUTH_EMULATOR_URL: z.undefined().optional(),
}).refine(
  (value) =>
    value.VITE_FIREBASE_AUTH_DOMAIN === `${value.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
);
