import { describe, expect, it } from "vitest";
import type { EdgeConfig } from "../../src/config/edge-config.js";
import { createInternalTokenProvider } from "../../src/infrastructure/internal-clients/token-provider.js";

function config(mode: "gcp" | "insecure-dev"): EdgeConfig {
  return { INTERNAL_AUTH_MODE: mode } as EdgeConfig;
}

describe("createInternalTokenProvider", () => {
  it("insecure-dev mode returns a fixed marker token", async () => {
    const provider = await createInternalTokenProvider(config("insecure-dev"), "http://identity");
    expect(await provider.getIdToken()).toBe("insecure-dev-token");
  });

  it("gcp mode returns a Google OIDC provider (no network at construction)", async () => {
    // Constructing GoogleAuth is lazy; getIdToken (not called here) is
    // what would hit the metadata server.
    const provider = await createInternalTokenProvider(config("gcp"), "http://identity.internal");
    expect(typeof provider.getIdToken).toBe("function");
  });
});
