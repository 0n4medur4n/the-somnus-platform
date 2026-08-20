import { Module } from "@nestjs/common";
import { CLOCK, type Clock, SystemClock } from "../../common/clock.js";
import { loadMaintenanceConfig } from "./maintenance.config.js";
import { MaintenanceController } from "./maintenance.controller.js";
import { MaintenanceService } from "./maintenance.service.js";
import {
  HttpMorpheoMaintenanceClient,
  type MorpheoMaintenanceClient,
} from "./morpheo-maintenance.client.js";

export const MORPHEO_MAINTENANCE_CLIENT = Symbol("MORPHEO_MAINTENANCE_CLIENT");

/**
 * The scheduled-jobs module (build plan §5.7 / §12.2). Not an isolated data module
 * (it owns no database); it calls Morpheo over HTTP to perform retention deletes.
 */
@Module({
  controllers: [MaintenanceController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: MORPHEO_MAINTENANCE_CLIENT,
      useFactory: (): MorpheoMaintenanceClient =>
        new HttpMorpheoMaintenanceClient(loadMaintenanceConfig(process.env).MORPHEO_BASE_URL),
    },
    {
      provide: MaintenanceService,
      useFactory: (clock: Clock, morpheo: MorpheoMaintenanceClient) => {
        const config = loadMaintenanceConfig(process.env);
        return new MaintenanceService(
          clock,
          morpheo,
          config.UNCLAIMED_ASSESSMENT_TTL_DAYS,
          config.CLAIM_TOKEN_TTL_HOURS,
        );
      },
      inject: [CLOCK, MORPHEO_MAINTENANCE_CLIENT],
    },
  ],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
