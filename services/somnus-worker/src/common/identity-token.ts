/**
 * Service-to-service identity for calls to private Cloud Run services (ADR 0008).
 *
 * Morpheo is private: Cloud Run lets a caller in only with a Google-signed ID
 * token for Morpheo's URL, issued to an account that holds `run.invoker` on it.
 * On Cloud Run the token comes from the metadata server, for this runtime's own
 * service account -- no key, no library. Anywhere else (local development,
 * tests) there is no metadata server and nothing is attached: the local Morpheo
 * is not behind Cloud Run IAM. The same rule as report's `IdentityHeaders`.
 *
 * Tokens last about an hour; each one is reused until five minutes before expiry.
 */

const METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const LIFETIME_MS = 55 * 60 * 1000;

export type TokenFetcher = (audience: string) => Promise<string>;
export type AuthHeaders = (audience: string) => Promise<Record<string, string>>;

async function fetchFromMetadata(audience: string): Promise<string> {
  const url = `${METADATA_URL}?audience=${encodeURIComponent(audience)}&format=full`;
  const response = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) {
    throw new Error(`metadata server refused an identity token: ${response.status}`);
  }
  return (await response.text()).trim();
}

/** Cloud Run sets K_SERVICE in services and CLOUD_RUN_JOB in jobs. */
export function onCloudRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["K_SERVICE"] || env["CLOUD_RUN_JOB"]);
}

/** `Authorization: Bearer <ID token>` for an audience, or nothing off Cloud Run. */
export function identityHeaders(
  options: { fetch?: TokenFetcher; enabled?: boolean; now?: () => number } = {},
): AuthHeaders {
  const fetchToken = options.fetch ?? fetchFromMetadata;
  const enabled = options.enabled ?? onCloudRun();
  const now = options.now ?? Date.now;
  const cache = new Map<string, { token: string; expires: number }>();

  return async (audience: string) => {
    if (!enabled) return {};
    let cached = cache.get(audience);
    if (cached === undefined || cached.expires <= now()) {
      cached = { token: await fetchToken(audience), expires: now() + LIFETIME_MS };
      cache.set(audience, cached);
    }
    return { authorization: `Bearer ${cached.token}` };
  };
}
