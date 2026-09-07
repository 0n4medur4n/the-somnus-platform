import { z } from "zod";

/**
 * The console's client configuration, in two tiers.
 *
 * All four values are public identifiers, never secrets (build plan §5.2 --
 * nothing sensitive lives in the browser). The Firebase web config in
 * particular is meant to ship in a bundle; what protects the console is the
 * session cookie and the internal-role guard on `/admin/v1/*`, not obscurity.
 *
 * The tiers exist because the loose schema has to accept the local emulator
 * stack, and the strict one must reject exactly that. A console pointed at
 * `localhost:8080` is not a degraded deploy, it is a broken page -- and it was
 * shipped once already, because the build accepted its own local defaults.
 */
export const AdminEnvSchema = z.object({
  VITE_EDGE_API_URL: z.url(),
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_AUTH_EMULATOR_URL: z.url().optional(),
});

/**
 * What a real Hosting build must satisfy. Deliberately identical to the SPA's
 * `HostingEnvSchema`: the console talks to the same edge API and the same
 * Firebase project, so anything valid for one is valid for the other, and a
 * divergence here would be a bug rather than a feature.
 *
 * Every clause rejects a specific way the local stack leaks into a real build:
 * `http://localhost:8080` fails the https check, `demo-api-key` fails the key
 * pattern, `somnus-dev-test.firebaseapp.com` is consistent but only paired with
 * project `somnus-dev-test`, and any emulator URL at all is refused outright.
 */
export const HostingEnvSchema = AdminEnvSchema.extend({
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
