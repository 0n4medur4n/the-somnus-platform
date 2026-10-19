import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { FunnelController } from "./funnel.controller.js";
import { FunnelProxyService } from "./funnel.service.js";

/**
 * The v2 interview proxy (embudo v0.2). Imports SessionsModule for the optional
 * session and `ActorResolver`; the morpheo and identity clients come from the
 * global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [FunnelController],
  providers: [FunnelProxyService],
  exports: [FunnelProxyService],
})
export class FunnelModule {}
