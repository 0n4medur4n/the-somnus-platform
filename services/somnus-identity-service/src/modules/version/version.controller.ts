import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

export type VersionInfo = {
  service: string;
  version: string;
  commit: string;
  env: string;
  node: string;
};

@ApiTags("version")
@Controller({ path: "version" })
export class VersionController {
  @Get()
  @ApiOperation({ summary: "Service build info (service, version, commit, env, node)." })
  version(): VersionInfo {
    const version = process.env["SERVICE_VERSION"] ?? "0.0.0";
    const commit = process.env["SERVICE_COMMIT"] ?? "local";
    const env = process.env["NODE_ENV"] ?? "development";
    return {
      service: "somnus-identity-service",
      version,
      commit,
      env,
      node: process.versions.node,
    };
  }
}
