import { Module } from "@nestjs/common";
import { loadEdgeConfig } from "../../config/edge-config.js";
import {
  createProfilePhotoStore,
  PROFILE_PHOTO_STORE,
} from "../../infrastructure/storage/profile-photo-store.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";

/**
 * Imports SessionsModule for `SessionGuard` and `ActorResolver`; the
 * identity client comes from the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [MeController],
  providers: [
    MeService,
    {
      provide: PROFILE_PHOTO_STORE,
      useFactory: () =>
        createProfilePhotoStore(
          loadEdgeConfig(process.env).PROFILE_PHOTOS_BUCKET,
          process.env["NODE_ENV"],
        ),
    },
  ],
})
export class MeModule {}
