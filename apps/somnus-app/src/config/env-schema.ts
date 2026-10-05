import { z } from "zod";

/**
 * `VITE_EDGE_API_URL` value meaning "the API is on this page's own origin": the
 * SPA calls `/v1/...` on whatever host serves it, and Firebase Hosting forwards
 * `/v1/**` to edge-api (firebase.json). Explicit rather than an empty string so
 * the bundle guard can still see that the setting was made.
 */
export const SAME_ORIGIN = "same-origin";

/**
 * Whether `domain` is the Firebase auth domain of `projectId`: normally
 * `<project>.firebaseapp.com`, or `<project>-<5 hex>.firebaseapp.com` when the
 * plain name was already taken across Firebase -- the case for `the-somnus`,
 * whose domain is `the-somnus-30c48.firebaseapp.com`. Narrow on purpose: it
 * still rejects a domain that belongs to a different project.
 */
export function isAuthDomainOf(domain: string, projectId: string): boolean {
  return (
    domain === `${projectId}.firebaseapp.com` ||
    (domain.startsWith(`${projectId}-`) &&
      /^-[0-9a-f]{5}\.firebaseapp\.com$/.test(domain.slice(projectId.length)))
  );
}

export const AppEnvSchema = z.object({
  VITE_EDGE_API_URL: z.union([z.literal(SAME_ORIGIN), z.url()]),
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_AUTH_EMULATOR_URL: z.url().optional(),
});

export const HostingEnvSchema = AppEnvSchema.extend({
  VITE_EDGE_API_URL: z.union([
    z.literal(SAME_ORIGIN),
    z.url().refine((value) => {
      // Zod 4 runs a refinement even when z.url() has already failed, and
      // `new URL` throws on a non-URL: catch it, so the schema rejects instead
      // of throwing.
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      );
    }),
  ]),
  VITE_FIREBASE_API_KEY: z.string().regex(/^AIza[\w-]{35}$/),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().regex(/^[a-z0-9-]+\.firebaseapp\.com$/),
  VITE_FIREBASE_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]+$/),
  VITE_AUTH_EMULATOR_URL: z.undefined().optional(),
}).refine((value) =>
  isAuthDomainOf(value.VITE_FIREBASE_AUTH_DOMAIN, value.VITE_FIREBASE_PROJECT_ID),
);
