import { Module } from "@nestjs/common";
import { SystemClock } from "../../common/clock.js";
import { DriveDbModule } from "./db/drive-db.module.js";
import { DriveRepository } from "./db/repositories/index.js";
import { DriveController } from "./drive.controller.js";
import { DriveService } from "./drive.service.js";

/**
 * The isolated Drive module (owner decision 2026-10-17, ADR 0019; ADR 0010).
 * Owns `somnus_drive` through DriveDbModule; the rest of the worker reaches it
 * only through DriveService, and in practice not at all -- its only caller is
 * edge-api, over HTTP.
 */
@Module({
  imports: [DriveDbModule],
  controllers: [DriveController],
  providers: [
    {
      provide: DriveService,
      useFactory: (repository: DriveRepository) => new DriveService(repository, new SystemClock()),
      inject: [DriveRepository],
    },
  ],
  exports: [DriveService],
})
export class DriveModule {}
