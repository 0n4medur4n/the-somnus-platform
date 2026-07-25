import { Global, Module } from "@nestjs/common";
import { type CloudRunClient, createCloudRunClient } from "@somnus/cloud-run-client";
import { type EdgeConfig, loadEdgeConfig } from "../../config/edge-config.js";
import { createInternalTokenProvider } from "./token-provider.js";

/**
 * DI token for the identity-service client. edge-api composes `/v1/me`
 * and proxies consent through this client; it is the ONLY way this
 * service reaches identity, and it carries an OIDC identity token, not
 * a database connection (build plan §5.3: no TiDB in edge-api).
 */
export const IDENTITY_CLIENT = Symbol("IDENTITY_CLIENT");
export type IdentityClient = CloudRunClient;

async function buildIdentityClient(config: EdgeConfig): Promise<CloudRunClient> {
  const audience = config.IDENTITY_AUDIENCE ?? config.IDENTITY_BASE_URL;
  const tokenProvider = await createInternalTokenProvider(config, audience);
  return createCloudRunClient({
    baseUrl: config.IDENTITY_BASE_URL,
    tokenProvider,
    defaultTimeoutMs: config.INTERNAL_TIMEOUT_MS,
    serviceName: "somnus-edge-api",
  });
}

/**
 * Global so any composing module (`me`, `consent`, and the actor
 * resolver) can inject the identity client. Built once at bootstrap
 * from validated config.
 */
@Global()
@Module({
  providers: [
    {
      provide: IDENTITY_CLIENT,
      useFactory: (): Promise<CloudRunClient> => buildIdentityClient(loadEdgeConfig(process.env)),
    },
  ],
  exports: [IDENTITY_CLIENT],
})
export class InternalClientsModule {}
