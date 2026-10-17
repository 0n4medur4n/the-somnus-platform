import { Module } from "@nestjs/common";
import { createDriveDb, createDrivePool, type DriveDb } from "./drive-db.client.js";
import { loadDriveDbConfig } from "./drive-db.config.js";
import { DriveRepository } from "./repositories/index.js";

export const DRIVE_DB = Symbol("DRIVE_DB");

/**
 * NOT `@Global()`: this connection and repository are Drive-internal state. Only
 * `DriveModule` imports this module; nothing else in the worker reaches the
 * Drive's tables (ADR 0010, isolated module).
 */
@Module({
  providers: [
    {
      provide: DRIVE_DB,
      useFactory: (): DriveDb => createDriveDb(createDrivePool(loadDriveDbConfig(process.env))),
    },
    {
      provide: DriveRepository,
      useFactory: (db: DriveDb) => new DriveRepository(db),
      inject: [DRIVE_DB],
    },
  ],
  exports: [DriveRepository],
})
export class DriveDbModule {}
