import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";
import type { TokenProvider } from "./client.js";

export type GoogleTokenProviderOptions = GoogleAuthOptions & {
  audience: string;
};

export class GoogleIdTokenTokenProvider implements TokenProvider {
  private readonly auth: GoogleAuth;
  private readonly audience: string;

  constructor(options: GoogleTokenProviderOptions) {
    if (!options.audience) {
      throw new Error("GoogleIdTokenTokenProvider requires an explicit audience");
    }
    this.auth = new GoogleAuth(options);
    this.audience = options.audience;
  }

  async getIdToken(): Promise<string> {
    const client = await this.auth.getIdTokenClient(this.audience);
    // google-auth-library returns a web `Headers` object; read the
    // (case-insensitive) Authorization header via its accessor.
    const headers = await client.getRequestHeaders();
    const auth = headers.get("authorization");
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      throw new Error("google-auth-library did not return a Bearer token");
    }
    return auth.substring("Bearer ".length);
  }
}

/**
 * An OAuth access token for a Google API (not an ID token for a Cloud Run
 * service): what calling Cloud Tasks, for instance, needs. Uses the runtime's
 * own service account; nothing is configured or stored here.
 */
export class GoogleAccessTokenProvider {
  private readonly auth: GoogleAuth;

  constructor(scopes: string[] = ["https://www.googleapis.com/auth/cloud-platform"]) {
    this.auth = new GoogleAuth({ scopes });
  }

  async getAccessToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("google-auth-library returned no access token");
    return token;
  }
}

export async function createGoogleTokenProvider(
  options: GoogleTokenProviderOptions,
): Promise<TokenProvider> {
  return new GoogleIdTokenTokenProvider(options);
}
