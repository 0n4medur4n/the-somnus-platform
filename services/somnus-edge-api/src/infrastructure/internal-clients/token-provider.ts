import { createGoogleTokenProvider, type TokenProvider } from "@somnus/cloud-run-client";
import type { EdgeConfig } from "../../config/edge-config.js";

/**
 * A fixed-token provider for local/docker/test runs (build plan §20
 * Checkpoint 8.2, `insecure-dev` auth mode). There is no GCP metadata
 * server locally and the identity service is not behind Cloud Run IAM,
 * so no real OIDC token can be (or needs to be) minted. The token value
 * is a marker, never a secret, and is never logged.
 */
class InsecureDevTokenProvider implements TokenProvider {
  async getIdToken(): Promise<string> {
    return "insecure-dev-token";
  }
}

/**
 * Selects how internal calls are authenticated. `gcp` mints a real
 * Google-signed OIDC identity token scoped to the downstream service's
 * audience (production on Cloud Run); `insecure-dev` sends a fixed
 * marker token for environments with no metadata server.
 */
export async function createInternalTokenProvider(
  config: EdgeConfig,
  audience: string,
): Promise<TokenProvider> {
  if (config.INTERNAL_AUTH_MODE === "gcp") {
    return createGoogleTokenProvider({ audience });
  }
  return new InsecureDevTokenProvider();
}
