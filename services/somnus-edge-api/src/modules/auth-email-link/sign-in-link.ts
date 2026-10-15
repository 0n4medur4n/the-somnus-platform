import { createHash } from "node:crypto";

/**
 * The link a person receives: our own callback with the one-time code and
 * nothing else. Firebase's generated link goes through its shared handler
 * domain and carries the web API key; ours lands straight in the app, and the
 * app adds the (public) key back before handing the link to the Firebase SDK.
 */
export function cleanSignInLink(generated: string, callbackUrl: string, locale: string): string {
  const source = new URL(generated);
  const oobCode = source.searchParams.get("oobCode");
  if (!oobCode) throw new Error("generated sign-in link carries no code");
  const target = new URL(callbackUrl);
  target.search = "";
  target.searchParams.set("mode", "signIn");
  target.searchParams.set("oobCode", oobCode);
  // `lng` is what the app reads its language from (i18next), so the link opens
  // in the language the person asked in.
  target.searchParams.set("lng", locale);
  return target.toString();
}

/**
 * The key a throttle record is stored under: a hash, never the address -- the
 * throttle must not become a list of who asked to sign in.
 */
export function throttleKey(email: string): string {
  return createHash("sha256").update(`sign-in-link:${email}`, "utf8").digest("hex");
}

/** Minimum time between two links to the same address. */
export const SAME_ADDRESS_INTERVAL_MS = 60_000;
