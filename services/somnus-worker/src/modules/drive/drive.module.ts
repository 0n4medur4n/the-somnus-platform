import { Module } from "@nestjs/common";
import { SystemClock } from "../../common/clock.js";
import { loadDriveConfig } from "./drive.config.js";
import { DriveController } from "./drive.controller.js";
import { DriveService } from "./drive.service.js";
import { loadSpeechConfig } from "./speech/speech.config.js";
import { SpeechController } from "./speech/speech.controller.js";
import { SpeechService } from "./speech/speech.service.js";
import { DriveStore } from "./storage/drive-store.js";
import { createObjectStore } from "./storage/object-store.js";

/**
 * The isolated Drive module (owner decision 2026-10-17, ADR 0019; ADR 0010).
 * Owns its private Cloud Storage bucket through DriveStore; the rest of the
 * worker reaches it only through DriveService, and in practice not at all --
 * its only caller is edge-api, over HTTP.
 */
@Module({
  controllers: [DriveController, SpeechController],
  providers: [
    {
      provide: DriveStore,
      useFactory: () =>
        new DriveStore(
          createObjectStore(loadDriveConfig(process.env).DRIVE_BUCKET, process.env["NODE_ENV"]),
        ),
    },
    {
      provide: DriveService,
      useFactory: (store: DriveStore) => new DriveService(store, new SystemClock()),
      inject: [DriveStore],
    },
    {
      provide: SpeechService,
      useFactory: () => new SpeechService(loadSpeechConfig(process.env)),
    },
  ],
  exports: [DriveService],
})
export class DriveModule {}
