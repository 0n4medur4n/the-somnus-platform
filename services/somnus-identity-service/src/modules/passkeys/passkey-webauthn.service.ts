import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { makeEvent, type UUIDv7 } from "@somnus/api-contracts";
import {
  evaluateSignCount,
  PasskeyCredentialIdConflict,
  PasskeyCredentialScopeMismatch,
  PasskeyHandleLockUnavailable,
  PasskeyPendingLimit,
} from "../../domain/passkey/passkey.js";
import {
  type AuthenticatorDataView,
  attestedAaguid,
  attestedCredentialAlgorithm,
  attestedCredentialId,
  authenticatorDataProblem,
  classifyUnconsumedChallenge,
  coseAlgorithm,
  extractAttestedAuthenticatorData,
  inspectClientData,
  isAllowedCoseAlgorithm,
  PASSKEY_COSE_ALGORITHMS,
  type PasskeyFailureCode,
  sameBytes,
} from "../../domain/passkey/webauthn-ceremony.js";
import { PasskeyChallengesRepository } from "../../infrastructure/db/repositories/passkey-challenges.repository.js";
import type { PasskeyCredentialRecord } from "../../infrastructure/db/repositories/passkey-credentials.repository.js";
import {
  PASSKEY_PENDING_CLEANUP_LIMIT,
  PasskeyCredentialsRepository,
} from "../../infrastructure/db/repositories/passkey-credentials.repository.js";
import { PasskeyUserHandlesRepository } from "../../infrastructure/db/repositories/passkey-user-handles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";
import { loadWebAuthnConfig, type WebAuthnConfig } from "./webauthn.config.js";

/**
 * WebAuthn ceremonies for console passkeys (ADR 0027, task 2.2).
 *
 * There is no HTTP route. Nothing here runs unless a caller invokes it, so
 * identity boots and serves as before when no WEBAUTHN_* variable is set.
 * The first call validates that configuration and throws WebAuthnConfigError
 * when it is missing or not allowed for the environment.
 *
 * Task 2.4 still needs the HTTP contracts: registration, authentication and
 * step-up request and response bodies, plus the audit types
 * auth.passkey.registered.v1, auth.passkey.used.v1, auth.passkey.failed.v1
 * and auth.passkey.locked.v1. The `.v1` suffix is the envelope's required
 * version; the ADR names the stems. Enrollment, session minting and the
 * switch stay out of this service.
 */

export const PASSKEY_EVENTS = {
  registered: "auth.passkey.registered.v1",
  used: "auth.passkey.used.v1",
  failed: "auth.passkey.failed.v1",
  locked: "auth.passkey.locked.v1",
} as const;

const WEBAUTHN_TRANSPORTS = new Set(["ble", "hybrid", "internal", "nfc", "usb", "smart-card"]);
const UNNAMED_PASSKEY = "";
const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;
const AUDIT_PUBLISH_TIMEOUT_MS = 2_000;

/** Byte caps applied to ceremony fields before any base64url decode. */
export const PASSKEY_SIZE_LIMITS = {
  credentialId: 1023,
  userHandle: 64,
  signature: 1024,
  clientDataJson: 2048,
  authenticatorData: 4096,
  attestationObject: 8192,
} as const;

/**
 * How a registration is allowed (ADR 0027 decisions 9 and 11).
 * `first` is only for an account with no active passkey. `additional`
 * requires a step-up the service itself just verified.
 */
export type PasskeyEnrollmentAuthorization =
  | { kind: "first" }
  | {
      kind: "additional";
      stepUp: { userId: UUIDv7; credentialId: string; verifiedAt: string };
    };

export type PasskeyCeremonyFailure = { readonly ok: false };

export type PasskeyRegistrationOptionsResult =
  | { readonly ok: true; readonly options: PublicKeyCredentialCreationOptionsJSON }
  | PasskeyCeremonyFailure;

export type PasskeyAuthenticationOptionsResult =
  | { readonly ok: true; readonly options: PublicKeyCredentialRequestOptionsJSON }
  | PasskeyCeremonyFailure;

export type PasskeyRegistrationResult =
  | { readonly ok: true; readonly credentialId: string }
  | PasskeyCeremonyFailure;

export type PasskeyAuthenticationResult =
  | {
      readonly ok: true;
      readonly userId: UUIDv7;
      readonly firebaseUid: string;
      readonly credentialId: string;
      readonly activated: boolean;
    }
  | PasskeyCeremonyFailure;

/** The fact edge-api will store later. This method does not create a session. */
export type PasskeyStepUpResult =
  | {
      readonly ok: true;
      readonly userId: UUIDv7;
      readonly credentialId: string;
      readonly verifiedAt: string;
    }
  | PasskeyCeremonyFailure;

type CeremonyPurpose = "registration" | "authentication" | "step_up";

type CheckedAssertion = {
  userId: UUIDv7;
  credential: PasskeyCredentialRecord;
  view: AuthenticatorDataView;
  credentialIdText: string;
};

@Injectable()
export class PasskeyWebAuthnService {
  private readonly logger = new Logger(PasskeyWebAuthnService.name);

  constructor(
    private readonly credentials: PasskeyCredentialsRepository,
    private readonly challenges: PasskeyChallengesRepository,
    private readonly handles: PasskeyUserHandlesRepository,
    private readonly users: UsersRepository,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async registrationOptions(
    userId: UUIDv7,
    correlationId: string,
    authorization: PasskeyEnrollmentAuthorization,
  ): Promise<PasskeyRegistrationOptionsResult> {
    const config = this.config();
    const account = await this.activeAccount(userId, "registration", correlationId);
    if (!account.ok) return account;
    const now = new Date();
    const enrollment = this.enrollmentFailure(
      userId,
      authorization,
      await this.activeCredentials(userId),
      now,
    );
    if (enrollment) return this.fail(correlationId, "registration", userId, null, enrollment);
    await this.credentials.deleteExpiredPending(PASSKEY_PENDING_CLEANUP_LIMIT);
    const pending = await this.credentials.countPendingByUser({ userId }, now);
    if (pending >= config.maxPendingCredentials) {
      return this.fail(correlationId, "registration", userId, null, "pending_limit");
    }
    const handle = await this.handles.getOrCreateForUser({ userId });
    const existing = await this.credentials.listByUser({ userId });
    const challenge = randomBytes(32);
    await this.challenges.create({
      challenge,
      purpose: "registration",
      userId,
      sessionBindingHash: null,
      expiresAt: new Date(now.getTime() + config.challengeTtlSeconds * 1000),
    });
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: account.email,
      userDisplayName: account.email,
      userID: new Uint8Array(handle),
      challenge: new Uint8Array(challenge),
      timeout: config.challengeTtlSeconds * 1000,
      attestationType: "none",
      supportedAlgorithmIDs: [...PASSKEY_COSE_ALGORITHMS],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: existing.filter((row) => row.revokedAt === null).map(descriptor),
    });
    return { ok: true, options };
  }

  async verifyRegistration(
    userId: UUIDv7,
    response: unknown,
    correlationId: string,
    authorization: PasskeyEnrollmentAuthorization,
  ): Promise<PasskeyRegistrationResult> {
    const config = this.config();
    const parsed = asRegistration(response);
    if (!parsed || !registrationWithinLimits(parsed)) {
      return this.fail(correlationId, "registration", userId, null, "client_data");
    }
    const clientData = bytesFromBase64Url(parsed.response.clientDataJSON);
    const client = clientData
      ? inspectClientData(clientData, { type: "webauthn.create", origin: config.origin })
      : { ok: false as const, code: "client_data" as const, challenge: null };
    if (!client.ok && client.challenge) {
      const rejected = await this.consumeOrClassify(
        client.challenge,
        "registration",
        userId,
        correlationId,
      );
      if (rejected) return rejected;
      return this.fail(correlationId, "registration", userId, null, client.code);
    }
    if (!client.ok) {
      return this.fail(correlationId, "registration", userId, null, client.code);
    }
    const rejected = await this.consumeOrClassify(
      client.challenge,
      "registration",
      userId,
      correlationId,
    );
    if (rejected) return rejected;
    let authData: Buffer | null;
    let flags: ReturnType<typeof authenticatorDataProblem> | null;
    try {
      const attestation = bytesFromBase64Url(parsed.response.attestationObject);
      authData = attestation ? extractAttestedAuthenticatorData(attestation) : null;
      flags = authData ? authenticatorDataProblem(authData, config.rpId) : null;
    } catch {
      return this.fail(correlationId, "registration", userId, null, "client_data");
    }
    if (!authData || !flags?.ok) {
      return this.fail(
        correlationId,
        "registration",
        userId,
        null,
        flags && !flags.ok ? flags.code : "client_data",
      );
    }
    const embeddedAlgorithm = attestedCredentialAlgorithm(authData);
    if (embeddedAlgorithm !== null && !isAllowedCoseAlgorithm(embeddedAlgorithm)) {
      return this.fail(correlationId, "registration", userId, null, "algorithm");
    }

    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      // One origin string and one rpId. No expectedTopOrigin: registration
      // verification in 14.1.0 does not read crossOrigin, which inspectClientData
      // already rejected. supportedAlgorithmIDs is explicit so the library
      // default cannot add ML-DSA-44.
      verified = await verifyRegistrationResponse({
        response: parsed,
        expectedChallenge: client.challengeText,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [...PASSKEY_COSE_ALGORITHMS],
      });
    } catch {
      return this.fail(correlationId, "registration", userId, null, "verification_rejected");
    }
    if (!verified.verified) {
      return this.fail(correlationId, "registration", userId, null, "verification_rejected");
    }
    const info = verified.registrationInfo;
    if (info.fmt !== "none") {
      return this.fail(correlationId, "registration", userId, null, "verification_rejected");
    }
    if (info.origin !== config.origin) {
      return this.fail(correlationId, "registration", userId, null, "origin");
    }
    if (info.rpID !== config.rpId) {
      return this.fail(correlationId, "registration", userId, null, "rp_id");
    }
    if (!info.userVerified) {
      return this.fail(correlationId, "registration", userId, null, "user_verification");
    }
    const publicKey = Buffer.from(info.credential.publicKey);
    const algorithm = coseAlgorithm(publicKey);
    if (algorithm === null || !isAllowedCoseAlgorithm(algorithm)) {
      return this.fail(correlationId, "registration", userId, null, "algorithm");
    }
    const credentialId = Buffer.from(isoBase64URL.toBuffer(info.credential.id));
    const embeddedId = attestedCredentialId(authData);
    if (
      !embeddedId ||
      !sameBytes(embeddedId, credentialId) ||
      credentialId.length > 1023 ||
      publicKey.length < 1 ||
      publicKey.length > 1024 ||
      info.credential.counter !== flags.view.signCount
    ) {
      return this.fail(correlationId, "registration", userId, null, "verification_rejected");
    }
    const libraryBackupEligible = info.credentialDeviceType === "multiDevice";
    if (libraryBackupEligible !== flags.view.be || info.credentialBackedUp !== flags.view.bs) {
      return this.fail(correlationId, "registration", userId, null, "verification_rejected");
    }
    const account = await this.activeAccount(userId, "registration", correlationId);
    if (!account.ok) return account;
    const credentialIdText = isoBase64URL.fromBuffer(uint8(credentialId));
    if (await this.credentials.findByCredentialId(credentialId)) {
      return this.fail(
        correlationId,
        "registration",
        userId,
        credentialIdText,
        "credential_duplicate",
      );
    }
    const now = new Date();
    const enrollment = this.enrollmentFailure(
      userId,
      authorization,
      await this.activeCredentials(userId),
      now,
    );
    if (enrollment) {
      return this.fail(correlationId, "registration", userId, credentialIdText, enrollment);
    }
    try {
      await this.credentials.createUnderPendingCap(
        { userId },
        {
          userId,
          credentialId,
          publicKey,
          coseAlgorithm: algorithm,
          signCount: flags.view.signCount,
          transports: knownTransports(parsed.response.transports),
          aaguid: attestedAaguid(authData),
          backupEligible: flags.view.be,
          backupState: flags.view.bs,
          name: UNNAMED_PASSKEY,
          pendingExpiresAt: new Date(now.getTime() + config.pendingTtlSeconds * 1000),
        },
        config.maxPendingCredentials,
        now,
      );
    } catch (error) {
      if (error instanceof PasskeyPendingLimit) {
        return this.fail(correlationId, "registration", userId, credentialIdText, "pending_limit");
      }
      if (error instanceof PasskeyCredentialIdConflict) {
        return this.fail(
          correlationId,
          "registration",
          userId,
          credentialIdText,
          "credential_duplicate",
        );
      }
      if (error instanceof PasskeyHandleLockUnavailable) {
        return this.fail(correlationId, "registration", userId, credentialIdText, "user_handle");
      }
      if (error instanceof PasskeyCredentialScopeMismatch) {
        return this.fail(correlationId, "registration", userId, credentialIdText, "enrollment");
      }
      throw error;
    }
    await this.audit({
      eventType: PASSKEY_EVENTS.registered,
      correlationId,
      purpose: "registration",
      userId,
      credentialId: credentialIdText,
    });
    return { ok: true, credentialId: credentialIdText };
  }

  async authenticationOptions(correlationId: string): Promise<PasskeyAuthenticationOptionsResult> {
    const options = await this.assertionOptions(null, "authentication", correlationId);
    return options;
  }

  async verifyAuthentication(
    response: unknown,
    correlationId: string,
  ): Promise<PasskeyAuthenticationResult> {
    const checked = await this.checkAssertion(response, {
      purpose: "authentication",
      boundUserId: null,
      correlationId,
      pending: "allow",
    });
    if (!checked.ok) return checked;
    const { credential, view, userId, credentialIdText } = checked.checked;
    const firebaseUid = await this.users.findFirebaseUid(userId);
    if (!firebaseUid) {
      return this.fail(
        correlationId,
        "authentication",
        userId,
        credentialIdText,
        "firebase_uid_missing",
      );
    }
    const now = new Date();
    const stored = credential.signCount;
    const received = view.signCount;
    const nextCount = received;
    const pending = credential.activatedAt === null;
    const wrote = pending
      ? await this.credentials.completePendingSignIn(
          { userId },
          credential.credentialId,
          stored,
          nextCount,
          now,
        )
      : await this.credentials.recordUse(
          { userId },
          credential.credentialId,
          stored,
          nextCount,
          laterInstant(credential.lastUsedAt, now),
          credential.lastUsedAt,
        );
    if (!wrote) {
      return this.fail(correlationId, "authentication", userId, credentialIdText, "counter_race");
    }
    await this.audit({
      eventType: PASSKEY_EVENTS.used,
      correlationId,
      purpose: "authentication",
      userId,
      credentialId: credentialIdText,
      activated: pending,
    });
    return { ok: true, userId, firebaseUid, credentialId: credentialIdText, activated: pending };
  }

  async stepUpOptions(
    userId: UUIDv7,
    correlationId: string,
  ): Promise<PasskeyAuthenticationOptionsResult> {
    return this.assertionOptions(userId, "step_up", correlationId);
  }

  async verifyStepUp(
    userId: UUIDv7,
    response: unknown,
    correlationId: string,
  ): Promise<PasskeyStepUpResult> {
    const checked = await this.checkAssertion(response, {
      purpose: "step_up",
      boundUserId: userId,
      correlationId,
      pending: "reject",
    });
    if (!checked.ok) return checked;
    const { credential, view, credentialIdText } = checked.checked;
    const now = new Date();
    const stored = credential.signCount;
    const received = view.signCount;
    const nextCount = received;
    const wrote = await this.credentials.recordUse(
      { userId },
      credential.credentialId,
      stored,
      nextCount,
      laterInstant(credential.lastUsedAt, now),
      credential.lastUsedAt,
    );
    if (!wrote)
      return this.fail(correlationId, "step_up", userId, credentialIdText, "counter_race");
    await this.audit({
      eventType: PASSKEY_EVENTS.used,
      correlationId,
      purpose: "step_up",
      userId,
      credentialId: credentialIdText,
    });
    return { ok: true, userId, credentialId: credentialIdText, verifiedAt: now.toISOString() };
  }

  /** Throws WebAuthnConfigError. Not called from the constructor or from boot. */
  private config(): WebAuthnConfig {
    return loadWebAuthnConfig(process.env);
  }

  /**
   * Burns the challenge before any later check, so a rejected origin or
   * crossOrigin flag cannot be edited and submitted again. Attestation
   * `none` does not sign clientDataJSON, so the delete is what makes the
   * attempt single-use.
   */
  private async consumeOrClassify(
    challenge: Buffer,
    purpose: CeremonyPurpose,
    userId: UUIDv7 | null,
    correlationId: string,
  ): Promise<PasskeyCeremonyFailure | null> {
    const consumed =
      userId === null
        ? await this.challenges.consume(challenge, purpose)
        : await this.challenges.consume(challenge, purpose, userId);
    if (consumed) return null;
    const binding = await this.challenges.findBinding(challenge);
    const code = classifyUnconsumedChallenge(binding, { purpose, userId, now: new Date() });
    return this.fail(correlationId, purpose, userId, null, code);
  }

  private async activeAccount(
    userId: UUIDv7,
    purpose: CeremonyPurpose,
    correlationId: string,
  ): Promise<{ ok: true; email: string } | PasskeyCeremonyFailure> {
    const user = await this.users.findById(userId);
    if (!user) return this.fail(correlationId, purpose, userId, null, "user_missing");
    if (user.status !== "active") {
      return this.fail(correlationId, purpose, userId, null, "account_not_active");
    }
    return { ok: true, email: user.email };
  }

  private async assertionOptions(
    userId: UUIDv7 | null,
    purpose: "authentication" | "step_up",
    correlationId: string,
  ): Promise<PasskeyAuthenticationOptionsResult> {
    const config = this.config();
    let allowCredentials: { id: string; transports?: string[] }[] = [];
    if (userId) {
      const account = await this.activeAccount(userId, purpose, correlationId);
      if (!account.ok) return account;
      const active = (await this.credentials.listByUser({ userId })).filter(
        (row) => row.activatedAt !== null && row.revokedAt === null && row.lockedAt === null,
      );
      if (active.length === 0) {
        return this.fail(correlationId, purpose, userId, null, "no_active_credential");
      }
      allowCredentials = active.map(descriptor);
    }
    const now = new Date();
    const challenge = randomBytes(32);
    await this.challenges.create({
      challenge,
      purpose,
      userId,
      sessionBindingHash: null,
      expiresAt: new Date(now.getTime() + config.challengeTtlSeconds * 1000),
    });
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      challenge: new Uint8Array(challenge),
      timeout: config.challengeTtlSeconds * 1000,
      userVerification: "required",
      allowCredentials,
    });
    return { ok: true, options };
  }

  private async checkAssertion(
    response: unknown,
    input: {
      purpose: "authentication" | "step_up";
      boundUserId: UUIDv7 | null;
      correlationId: string;
      pending: "allow" | "reject";
    },
  ): Promise<{ ok: true; checked: CheckedAssertion } | PasskeyCeremonyFailure> {
    const config = this.config();
    const parsed = asAuthentication(response);
    if (!parsed || !authenticationWithinLimits(parsed)) {
      return this.fail(input.correlationId, input.purpose, input.boundUserId, null, "client_data");
    }
    const clientData = bytesFromBase64Url(parsed.response.clientDataJSON);
    const client = clientData
      ? inspectClientData(clientData, { type: "webauthn.get", origin: config.origin })
      : { ok: false as const, code: "client_data" as const, challenge: null };
    if (!client.ok && client.challenge) {
      const rejected = await this.consumeOrClassify(
        client.challenge,
        input.purpose,
        input.boundUserId,
        input.correlationId,
      );
      if (rejected) return rejected;
      return this.fail(input.correlationId, input.purpose, input.boundUserId, null, client.code);
    }
    if (!client.ok) {
      return this.fail(input.correlationId, input.purpose, input.boundUserId, null, client.code);
    }
    const rejected = await this.consumeOrClassify(
      client.challenge,
      input.purpose,
      input.boundUserId,
      input.correlationId,
    );
    if (rejected) return rejected;
    let authData: Buffer | null;
    let flags: ReturnType<typeof authenticatorDataProblem> | null;
    try {
      authData = bytesFromBase64Url(parsed.response.authenticatorData);
      flags = authData ? authenticatorDataProblem(authData, config.rpId) : null;
    } catch {
      return this.fail(input.correlationId, input.purpose, input.boundUserId, null, "client_data");
    }
    if (!authData || !flags?.ok) {
      return this.fail(
        input.correlationId,
        input.purpose,
        input.boundUserId,
        null,
        flags && !flags.ok ? flags.code : "client_data",
      );
    }
    const credentialId = bytesFromBase64Url(parsed.id);
    const credential = credentialId
      ? await this.credentials.findByCredentialId(credentialId)
      : null;
    const credentialIdText = credential
      ? isoBase64URL.fromBuffer(uint8(credential.credentialId))
      : null;
    if (!credential || !credentialIdText) {
      return this.fail(
        input.correlationId,
        input.purpose,
        input.boundUserId,
        null,
        "credential_unknown",
      );
    }
    const holder = credential.userId as UUIDv7;
    if (credential.revokedAt !== null) {
      return this.fail(
        input.correlationId,
        input.purpose,
        holder,
        credentialIdText,
        "credential_revoked",
      );
    }
    if (credential.lockedAt !== null) {
      return this.fail(
        input.correlationId,
        input.purpose,
        holder,
        credentialIdText,
        "credential_locked",
      );
    }
    if (input.boundUserId !== null && holder !== input.boundUserId) {
      return this.fail(
        input.correlationId,
        input.purpose,
        input.boundUserId,
        credentialIdText,
        "credential_user",
      );
    }
    if (credential.activatedAt === null) {
      if (input.pending === "reject") {
        return this.fail(
          input.correlationId,
          input.purpose,
          holder,
          credentialIdText,
          "credential_pending",
        );
      }
      const deadline = credential.pendingExpiresAt;
      if (deadline === null || deadline.getTime() <= Date.now()) {
        return this.fail(
          input.correlationId,
          input.purpose,
          holder,
          credentialIdText,
          "pending_expired",
        );
      }
    }
    if (!isAllowedCoseAlgorithm(credential.coseAlgorithm)) {
      return this.fail(input.correlationId, input.purpose, holder, credentialIdText, "algorithm");
    }
    const account = await this.activeAccount(holder, input.purpose, input.correlationId);
    if (!account.ok) return account;
    let presented: Buffer | null;
    try {
      presented = parsed.response.userHandle
        ? bytesFromBase64Url(parsed.response.userHandle)
        : null;
    } catch {
      return this.fail(input.correlationId, input.purpose, holder, credentialIdText, "client_data");
    }
    const storedHandle = await this.handles.findForUser({ userId: holder });
    if (!storedHandle) {
      return this.fail(input.correlationId, input.purpose, holder, credentialIdText, "user_handle");
    }
    const handleMatches = presented !== null && sameBytes(presented, storedHandle);
    if (input.purpose === "step_up") {
      if (presented !== null && !handleMatches) {
        return this.fail(
          input.correlationId,
          input.purpose,
          holder,
          credentialIdText,
          "user_handle",
        );
      }
    } else if (!handleMatches) {
      return this.fail(input.correlationId, input.purpose, holder, credentialIdText, "user_handle");
    }

    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      // counter 0 disables the library's own regression check, which treats a
      // received 0 as harmless whenever the value it was given is 0. The rule
      // that matters is evaluateSignCount: a received 0 is a regression when
      // the stored count is above zero. The conditional update applies that
      // same rule and is what makes one of two equal counters win.
      // expectedOrigin is one string. expectedTopOrigin is omitted: a true
      // crossOrigin without topOrigin is not rejected by 14.1.0, so
      // inspectClientData rejected it first.
      verified = await verifyAuthenticationResponse({
        response: parsed,
        expectedChallenge: client.challengeText,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: {
          id: credentialIdText,
          publicKey: uint8(credential.publicKey),
          counter: 0,
        },
      });
    } catch {
      return this.fail(
        input.correlationId,
        input.purpose,
        holder,
        credentialIdText,
        "verification_rejected",
      );
    }
    if (!verified.verified || verified.authenticationInfo.newCounter !== flags.view.signCount) {
      return this.fail(
        input.correlationId,
        input.purpose,
        holder,
        credentialIdText,
        "verification_rejected",
      );
    }
    if (verified.authenticationInfo.origin !== config.origin) {
      return this.fail(input.correlationId, input.purpose, holder, credentialIdText, "origin");
    }
    if (
      verified.authenticationInfo.rpID !== config.rpId ||
      !verified.authenticationInfo.userVerified
    ) {
      return this.fail(
        input.correlationId,
        input.purpose,
        holder,
        credentialIdText,
        verified.authenticationInfo.userVerified ? "rp_id" : "user_verification",
      );
    }
    if (evaluateSignCount(credential.signCount, flags.view.signCount) === "regression") {
      const locked = await this.credentials.lockAtSignCount(
        { userId: holder },
        credential.credentialId,
        credential.signCount,
        new Date(),
      );
      if (locked) {
        await this.audit({
          eventType: PASSKEY_EVENTS.locked,
          correlationId: input.correlationId,
          purpose: input.purpose,
          userId: holder,
          credentialId: credentialIdText,
          reason: "sign_count",
        });
        return { ok: false };
      }
      return this.fail(input.correlationId, input.purpose, holder, credentialIdText, "sign_count");
    }
    return {
      ok: true,
      checked: { userId: holder, credential, view: flags.view, credentialIdText },
    };
  }

  private async fail(
    correlationId: string,
    purpose: CeremonyPurpose,
    userId: UUIDv7 | null,
    credentialId: string | null,
    reason: PasskeyFailureCode,
  ): Promise<PasskeyCeremonyFailure> {
    await this.audit({
      eventType: PASSKEY_EVENTS.failed,
      correlationId,
      purpose,
      userId,
      credentialId,
      reason,
    });
    return { ok: false };
  }

  private async audit(input: {
    eventType: string;
    correlationId: string;
    purpose: CeremonyPurpose;
    userId: UUIDv7 | null;
    credentialId: string | null;
    reason?: PasskeyFailureCode;
    activated?: boolean;
  }): Promise<void> {
    const data: Record<string, string | boolean> = { purpose: input.purpose };
    if (input.credentialId !== null) data["credentialId"] = input.credentialId;
    if (input.reason !== undefined) data["reason"] = input.reason;
    if (input.activated !== undefined) data["activated"] = input.activated;
    const subject = input.userId
      ? { type: "user", id: input.userId }
      : input.credentialId
        ? { type: "passkey", id: input.credentialId }
        : { type: "passkey", id: input.purpose };
    const correlationId = input.correlationId.trim() || "passkey";
    const published = this.events
      .publish(
        makeEvent({
          eventType: input.eventType,
          producer: "somnus-identity-service",
          correlationId,
          subject,
          ...(input.userId ? { actor: { type: "user", id: input.userId } } : {}),
          data,
        }),
      )
      .then(
        () => "ok" as const,
        () => "failed" as const,
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), AUDIT_PUBLISH_TIMEOUT_MS);
    });
    const outcome = await Promise.race([published, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    if (outcome !== "ok") this.logger.warn("passkey audit publish failed");
  }

  private async activeCredentials(userId: UUIDv7): Promise<PasskeyCredentialRecord[]> {
    const rows = await this.credentials.listByUser({ userId });
    return rows.filter(
      (row) => row.activatedAt !== null && row.revokedAt === null && row.lockedAt === null,
    );
  }

  /**
   * `first` requires zero active credentials. `additional` requires a
   * step-up for this user, at most five minutes old, of an active
   * credential. Pending credentials satisfy neither rule.
   */
  private enrollmentFailure(
    userId: UUIDv7,
    authorization: PasskeyEnrollmentAuthorization,
    active: PasskeyCredentialRecord[],
    now: Date,
  ): PasskeyFailureCode | null {
    if (authorization.kind === "first") return active.length === 0 ? null : "enrollment";
    if (authorization.kind !== "additional") return "enrollment";
    const stepUp = authorization.stepUp;
    if (
      stepUp === undefined ||
      stepUp.userId !== userId ||
      typeof stepUp.credentialId !== "string" ||
      typeof stepUp.verifiedAt !== "string"
    ) {
      return "enrollment";
    }
    const verifiedAt = Date.parse(stepUp.verifiedAt);
    if (Number.isNaN(verifiedAt)) return "enrollment";
    const age = now.getTime() - verifiedAt;
    if (age < 0 || age > STEP_UP_MAX_AGE_MS) return "enrollment";
    const matches = active.some(
      (row) => isoBase64URL.fromBuffer(uint8(row.credentialId)) === stepUp.credentialId,
    );
    return matches ? null : "enrollment";
  }
}

function laterInstant(previous: Date | null, now: Date): Date {
  const nowSecond = Math.floor(now.getTime() / 1000);
  if (previous === null) return new Date(nowSecond * 1000);
  const previousSecond = Math.floor(previous.getTime() / 1000);
  if (nowSecond <= previousSecond) return new Date((previousSecond + 1) * 1000);
  return new Date(nowSecond * 1000);
}

function knownTransports(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const transports = value.filter(
    (item): item is string => typeof item === "string" && WEBAUTHN_TRANSPORTS.has(item),
  );
  return transports.length > 0 ? transports : null;
}

function descriptor(row: PasskeyCredentialRecord): { id: string; transports?: string[] } {
  const id = isoBase64URL.fromBuffer(uint8(row.credentialId));
  const transports = knownTransports(row.transports);
  if (!transports) return { id };
  return { id, transports };
}

function uint8(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function maxBase64UrlLength(maxBytes: number): number {
  const groups = Math.floor(maxBytes / 3);
  const rest = maxBytes % 3;
  return groups * 4 + (rest === 0 ? 0 : rest + 1);
}

function withinEncodedLimit(value: string, maxBytes: number): boolean {
  return value.length <= maxBase64UrlLength(maxBytes);
}

function registrationWithinLimits(parsed: RegistrationResponseJSON): boolean {
  return (
    withinEncodedLimit(parsed.id, PASSKEY_SIZE_LIMITS.credentialId) &&
    withinEncodedLimit(parsed.rawId, PASSKEY_SIZE_LIMITS.credentialId) &&
    withinEncodedLimit(parsed.response.clientDataJSON, PASSKEY_SIZE_LIMITS.clientDataJson) &&
    withinEncodedLimit(parsed.response.attestationObject, PASSKEY_SIZE_LIMITS.attestationObject)
  );
}

function authenticationWithinLimits(parsed: AuthenticationResponseJSON): boolean {
  const handle = parsed.response.userHandle;
  const handleOk =
    handle === undefined ||
    (typeof handle === "string" && withinEncodedLimit(handle, PASSKEY_SIZE_LIMITS.userHandle));
  return (
    handleOk &&
    withinEncodedLimit(parsed.id, PASSKEY_SIZE_LIMITS.credentialId) &&
    withinEncodedLimit(parsed.rawId, PASSKEY_SIZE_LIMITS.credentialId) &&
    withinEncodedLimit(parsed.response.clientDataJSON, PASSKEY_SIZE_LIMITS.clientDataJson) &&
    withinEncodedLimit(parsed.response.authenticatorData, PASSKEY_SIZE_LIMITS.authenticatorData) &&
    withinEncodedLimit(parsed.response.signature, PASSKEY_SIZE_LIMITS.signature)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesFromBase64Url(value: unknown): Buffer | null {
  try {
    if (typeof value !== "string" || value.length === 0 || !isoBase64URL.isBase64URL(value)) {
      return null;
    }
    const bytes = Buffer.from(isoBase64URL.toBuffer(value));
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function asRegistration(value: unknown): RegistrationResponseJSON | null {
  if (!isRecord(value) || !isRecord(value["response"])) return null;
  if (typeof value["id"] !== "string" || typeof value["rawId"] !== "string") return null;
  if (value["id"] !== value["rawId"] || value["type"] !== "public-key") return null;
  const response = value["response"];
  if (typeof response["clientDataJSON"] !== "string") return null;
  if (typeof response["attestationObject"] !== "string") return null;
  return value as unknown as RegistrationResponseJSON;
}

function asAuthentication(value: unknown): AuthenticationResponseJSON | null {
  if (!isRecord(value) || !isRecord(value["response"])) return null;
  if (typeof value["id"] !== "string" || typeof value["rawId"] !== "string") return null;
  if (value["id"] !== value["rawId"] || value["type"] !== "public-key") return null;
  const response = value["response"];
  if (typeof response["clientDataJSON"] !== "string") return null;
  if (typeof response["authenticatorData"] !== "string") return null;
  if (typeof response["signature"] !== "string") return null;
  return value as unknown as AuthenticationResponseJSON;
}
