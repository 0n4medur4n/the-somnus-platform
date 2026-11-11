import { Module } from "@nestjs/common";
import { PasskeyWebAuthnService } from "./passkey-webauthn.service.js";

/**
 * The passkey ceremony, with no controller. Routes arrive in a later task.
 * The module does not read WEBAUTHN_* while it is constructed.
 */
@Module({
  providers: [PasskeyWebAuthnService],
  exports: [PasskeyWebAuthnService],
})
export class PasskeyModule {}
