import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller({ path: "health" })
export class HealthController {
  @Get("live")
  @ApiOperation({ summary: "Liveness probe. Always 200 if the process is up." })
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness probe. Returns 200 when the service can serve traffic." })
  ready(): { status: "ready" } {
    // At Phase 3.1 the service has no external dependencies; it is
    // ready as soon as it can answer HTTP. Later phases will check
    // database connectivity here.
    return { status: "ready" };
  }
}
