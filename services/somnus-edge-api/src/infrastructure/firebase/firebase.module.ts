import { Global, Module } from "@nestjs/common";
import { loadEdgeConfig } from "../../config/edge-config.js";
import { FirebaseService } from "./firebase.service.js";

/**
 * @Global so the single firebase-admin app is shared everywhere
 * (initializeApp must run at most once per process).
 */
@Global()
@Module({
  providers: [
    {
      provide: FirebaseService,
      useFactory: () => {
        const config = loadEdgeConfig(process.env);
        return new FirebaseService(config.FIREBASE_PROJECT_ID, config.FIRESTORE_PROJECT_ID);
      },
    },
  ],
  exports: [FirebaseService],
})
export class FirebaseModule {}
