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
    const headers = await client.getRequestHeaders();
    const auth = headers["Authorization"] ?? headers["authorization"];
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      throw new Error("google-auth-library did not return a Bearer token");
    }
    return auth.substring("Bearer ".length);
  }
}

export async function createGoogleTokenProvider(
  options: GoogleTokenProviderOptions,
): Promise<TokenProvider> {
  return new GoogleIdTokenTokenProvider(options);
}
