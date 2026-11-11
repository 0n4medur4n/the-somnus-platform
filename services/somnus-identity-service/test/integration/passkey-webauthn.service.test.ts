import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import { type EventEnvelope, UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as ceremony from "../../src/domain/passkey/webauthn-ceremony.js";
import { isPasskeyFailureCode } from "../../src/domain/passkey/webauthn-ceremony.js";
import { PasskeyChallengesRepository } from "../../src/infrastructure/db/repositories/passkey-challenges.repository.js";
import { PasskeyCredentialsRepository } from "../../src/infrastructure/db/repositories/passkey-credentials.repository.js";
import { PasskeyUserHandlesRepository } from "../../src/infrastructure/db/repositories/passkey-user-handles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import {
  passkeyChallenges,
  passkeyCredentials,
  passkeyUserHandles,
  roleAssignments,
} from "../../src/infrastructure/db/schema/index.js";
import type { EventPublisher } from "../../src/infrastructure/events/event-publisher.js";
import {
  PASSKEY_EVENTS,
  PASSKEY_SIZE_LIMITS,
  PasskeyWebAuthnService,
} from "../../src/modules/passkeys/passkey-webauthn.service.js";
import { WebAuthnConfigError } from "../../src/modules/passkeys/webauthn.config.js";
import {
  authenticationResponse,
  type CeremonyShape,
  createSoftwareAuthenticator,
  registrationResponse,
  type SoftwareAuthenticator,
} from "../support/webauthn-authenticator.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

const ORIGIN = "https://console.thesomnus.com";
const RP_ID = "console.thesomnus.com";
const AUDIT_KEYS = new Set(["purpose", "credentialId", "reason", "activated"]);

describe("passkey WebAuthn service (ADR 0027 task 2.2)", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const credentials = new PasskeyCredentialsRepository(db);
  const challenges = new PasskeyChallengesRepository(db);
  const handles = new PasskeyUserHandlesRepository(db);
  const events: EventEnvelope[] = [];
  const publisher: EventPublisher = {
    async publish(event) {
      events.push(event);
    },
  };
  const service = new PasskeyWebAuthnService(credentials, challenges, handles, users, publisher);

  beforeAll(() => {
    process.env["WEBAUTHN_RP_ID"] = RP_ID;
    process.env["WEBAUTHN_ORIGIN"] = ORIGIN;
  });

  afterAll(() => {
    delete process.env["WEBAUTHN_RP_ID"];
    delete process.env["WEBAUTHN_ORIGIN"];
  });

  beforeEach(async () => {
    await resetTables();
    events.splice(0, events.length);
  });

  afterEach(() => {
    for (const event of events) {
      for (const key of Object.keys(event.data)) {
        expect(AUDIT_KEYS.has(key)).toBe(true);
      }
      const reason = event.data["reason"];
      if (reason !== undefined) expect(isPasskeyFailureCode(reason)).toBe(true);
      const serialized = JSON.stringify(event);
      expect(serialized.includes("@")).toBe(false);
      expect(serialized.includes("clientDataJSON")).toBe(false);
      expect(serialized.includes("attestationObject")).toBe(false);
    }
  });

  function expectClean(forbidden: Array<string | undefined>) {
    const serialized = JSON.stringify(events);
    const leaked = forbidden.some(
      (secret) => typeof secret === "string" && secret.length > 8 && serialized.includes(secret),
    );
    expect(leaked).toBe(false);
  }

  async function person(email: string, firebaseUid = `firebase-${email}`) {
    const userId = await users.create({ email });
    await users.linkIdentity({ userId, providerUserId: firebaseUid });
    return userId;
  }

  async function startRegistration(userId: string) {
    const options = await service.registrationOptions(userId as UUIDv7, "corr", { kind: "first" });
    expect(options.ok).toBe(true);
    if (!options.ok) throw new Error("registration options were refused");
    const handle = Buffer.from(options.options.user.id, "base64url");
    const authenticator = createSoftwareAuthenticator(handle);
    return { options: options.options, authenticator, handle };
  }

  function registerResponse(
    authenticator: SoftwareAuthenticator,
    challenge: string,
    shape: Partial<CeremonyShape> = {},
  ) {
    return registrationResponse(authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge,
      ...shape,
    });
  }

  async function enroll(email: string) {
    const userId = await person(email);
    const started = await startRegistration(userId);
    const response = registerResponse(started.authenticator, started.options.challenge);
    const verified = await service.verifyRegistration(userId, response, "corr", { kind: "first" });
    expect(verified.ok).toBe(true);
    expectClean([
      started.options.challenge,
      response.response.clientDataJSON,
      response.response.attestationObject,
    ]);
    return { userId, authenticator: started.authenticator, handle: started.handle };
  }

  async function signIn(
    authenticator: SoftwareAuthenticator,
    signCount: number,
    shape: Partial<CeremonyShape> & { userHandle?: Buffer | null } = {},
  ) {
    const options = await service.authenticationOptions("corr");
    expect(options.ok).toBe(true);
    if (!options.ok) throw new Error("authentication options were refused");
    const response = authenticationResponse(authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: options.options.challenge,
      signCount,
      ...shape,
    });
    const result = await service.verifyAuthentication(response, "corr");
    expectClean([
      options.options.challenge,
      response.response.clientDataJSON,
      response.response.authenticatorData,
      response.response.signature,
    ]);
    return { options: options.options, response, result };
  }

  it("rejects a wrong origin and origin tricks", async () => {
    const enrolled = await enroll("origin@example.com");
    await signIn(enrolled.authenticator, 1);
    const tricks = [
      "https://evil.example",
      "https://console.thesomnus.com.example",
      "https://example.com/console.thesomnus.com",
      "http://console.thesomnus.com",
      "https://console.thesomnus.com:443",
      "https://console.thesomnus.com.",
      "https://Console.thesomnus.com",
    ];
    for (const origin of tricks) {
      events.splice(0, events.length);
      const options = await service.authenticationOptions("corr");
      expect(options.ok).toBe(true);
      if (!options.ok) continue;
      const response = authenticationResponse(enrolled.authenticator, {
        origin,
        rpId: RP_ID,
        challenge: options.options.challenge,
        signCount: 2,
      });
      expect(await service.verifyAuthentication(response, "corr"), origin).toEqual({ ok: false });
      expect(events.some((event) => event.data["reason"] === "origin")).toBe(true);
      expectClean([
        options.options.challenge,
        response.response.clientDataJSON,
        response.response.signature,
      ]);
    }
  });

  it("rejects a wrong rpId", async () => {
    const enrolled = await enroll("rpid@example.com");
    const options = await service.authenticationOptions("corr");
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const response = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: "example.com",
      challenge: options.options.challenge,
      signCount: 1,
    });
    expect(await service.verifyAuthentication(response, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("rp_id");
  });

  it("rejects crossOrigin true and any topOrigin, including a registration the library would accept", async () => {
    const userId = await person("cross@example.com");
    const started = await startRegistration(userId);
    const cross = registerResponse(started.authenticator, started.options.challenge, {
      crossOrigin: true,
    });
    expect(await service.verifyRegistration(userId, cross, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.some((event) => event.data["reason"] === "cross_origin")).toBe(true);

    const enrolled = await enroll("top@example.com");
    const options = await service.authenticationOptions("corr");
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const withTop = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: options.options.challenge,
      signCount: 1,
      crossOrigin: true,
    });
    expect(await service.verifyAuthentication(withTop, "corr")).toEqual({ ok: false });
    const again = await service.authenticationOptions("corr");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const top = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: again.options.challenge,
      signCount: 1,
      topOrigin: "https://evil.example",
    });
    expect(await service.verifyAuthentication(top, "corr")).toEqual({ ok: false });
    expect(events.some((event) => event.data["reason"] === "top_origin")).toBe(true);
  });

  it("rejects a reused challenge, an expired one, another user's, and another purpose", async () => {
    const owner = await person("reuse@example.com");
    const started = await startRegistration(owner);
    const response = registerResponse(started.authenticator, started.options.challenge);
    expect((await service.verifyRegistration(owner, response, "corr", { kind: "first" })).ok).toBe(
      true,
    );
    expect(await service.verifyRegistration(owner, response, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_rejected");
    expectClean([
      started.options.challenge,
      response.response.clientDataJSON,
      response.response.attestationObject,
    ]);
  });

  it("rejects an expired challenge, a challenge bound to someone else, and a challenge of another purpose", async () => {
    const owner = await person("bound@example.com");
    const other = await person("other-bound@example.com");
    const started = await startRegistration(owner);
    await db.update(passkeyChallenges).set({ expiresAt: new Date(Date.now() - 60_000) });
    expect(
      await service.verifyRegistration(
        owner,
        registerResponse(started.authenticator, started.options.challenge),
        "corr",
        { kind: "first" },
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_expired");

    events.splice(0, events.length);
    const foreign = await startRegistration(owner);
    expect(
      await service.verifyRegistration(
        other,
        registerResponse(foreign.authenticator, foreign.options.challenge),
        "corr",
        { kind: "first" },
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_user");

    events.splice(0, events.length);
    const nameless = await service.authenticationOptions("corr");
    expect(nameless.ok).toBe(true);
    if (!nameless.ok) return;
    const authenticator = createSoftwareAuthenticator(randomBytes(32));
    expect(
      await service.verifyRegistration(
        owner,
        registrationResponse(authenticator, {
          origin: ORIGIN,
          rpId: RP_ID,
          challenge: nameless.options.challenge,
        }),
        "corr",
        { kind: "first" },
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_purpose");
  });

  it("rejects user verification false and does not activate", async () => {
    const userId = await person("uv@example.com");
    const started = await startRegistration(userId);
    const response = registerResponse(started.authenticator, started.options.challenge, {
      userVerified: false,
    });
    expect(await service.verifyRegistration(userId, response, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("user_verification");
    expect(await credentials.findByCredentialId(started.authenticator.credentialId)).toBeNull();
  });

  it("rejects an unknown, revoked, or locked credential without saying which", async () => {
    const options = await service.authenticationOptions("corr");
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const stranger = createSoftwareAuthenticator(randomBytes(32));
    expect(
      await service.verifyAuthentication(
        authenticationResponse(stranger, {
          origin: ORIGIN,
          rpId: RP_ID,
          challenge: options.options.challenge,
          signCount: 1,
        }),
        "corr",
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("credential_unknown");

    const enrolled = await enroll("revoked@example.com");
    const first = await signIn(enrolled.authenticator, 1);
    expect(first.result.ok).toBe(true);
    await credentials.revoke(
      { userId: enrolled.userId },
      enrolled.authenticator.credentialId,
      new Date(),
    );
    const revoked = await signIn(enrolled.authenticator, 2);
    expect(revoked.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("credential_revoked");

    const lockedUser = await enroll("locked@example.com");
    expect((await signIn(lockedUser.authenticator, 1)).result.ok).toBe(true);
    await credentials.lock(
      { userId: lockedUser.userId },
      lockedUser.authenticator.credentialId,
      new Date(),
    );
    const locked = await signIn(lockedUser.authenticator, 2);
    expect(locked.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("credential_locked");
  });

  it("locks and refuses a sign count regression", async () => {
    const enrolled = await enroll("regression@example.com");
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
    events.splice(0, events.length);
    const again = await signIn(enrolled.authenticator, 1);
    expect(again.result).toEqual({ ok: false });
    expect(events.some((event) => event.eventType === PASSKEY_EVENTS.locked)).toBe(true);
    expect(events.some((event) => event.data["reason"] === "sign_count")).toBe(true);
    const row = await credentials.findByCredentialId(enrolled.authenticator.credentialId);
    expect(row?.lockedAt).not.toBeNull();
    expect(row?.signCount).toBe(1);
  });

  it("lets exactly one of two verifications with the same counter succeed", async () => {
    const enrolled = await enroll("race@example.com");
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
    const first = await service.authenticationOptions("corr");
    const second = await service.authenticationOptions("corr");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const responses = [first.options.challenge, second.options.challenge].map((challenge) =>
      authenticationResponse(enrolled.authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge,
        signCount: 2,
      }),
    );
    const results = await Promise.all(
      responses.map((response) => service.verifyAuthentication(response, "corr")),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const row = await credentials.findByCredentialId(enrolled.authenticator.credentialId);
    expect(row?.signCount).toBe(2);
    expect(row?.lockedAt).toBeNull();
  });

  it("refuses an expired pending credential and does not let a pending credential step up", async () => {
    const expiredUser = await person("pending-expired@example.com");
    const started = await startRegistration(expiredUser);
    expect(
      (
        await service.verifyRegistration(
          expiredUser,
          registerResponse(started.authenticator, started.options.challenge),
          "corr",
          { kind: "first" },
        )
      ).ok,
    ).toBe(true);
    await db
      .update(passkeyCredentials)
      .set({ pendingExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(passkeyCredentials.userId, expiredUser));
    const attempt = await signIn(started.authenticator, 1);
    expect(attempt.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("pending_expired");
    expect(
      (await credentials.findByCredentialId(started.authenticator.credentialId))?.activatedAt,
    ).toBeNull();

    const pendingOnly = await enroll("pending-step@example.com");
    expect(await service.stepUpOptions(pendingOnly.userId, "corr")).toEqual({ ok: false });

    const holder = await enroll("holder-step@example.com");
    expect((await signIn(holder.authenticator, 1)).result.ok).toBe(true);
    const proofOptions = await service.stepUpOptions(holder.userId, "corr");
    expect(proofOptions.ok).toBe(true);
    if (!proofOptions.ok) return;
    const proof = await service.verifyStepUp(
      holder.userId,
      authenticationResponse(holder.authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: proofOptions.options.challenge,
        signCount: 2,
      }),
      "corr",
    );
    expect(proof.ok).toBe(true);
    if (!proof.ok) return;
    const secondOptions = await service.registrationOptions(holder.userId, "corr", {
      kind: "additional",
      stepUp: {
        userId: holder.userId,
        credentialId: proof.credentialId,
        verifiedAt: proof.verifiedAt,
      },
    });
    expect(secondOptions.ok).toBe(true);
    if (!secondOptions.ok) return;
    const secondAuthenticator = createSoftwareAuthenticator(
      Buffer.from(secondOptions.options.user.id, "base64url"),
    );
    expect(
      (
        await service.verifyRegistration(
          holder.userId,
          registrationResponse(secondAuthenticator, {
            origin: ORIGIN,
            rpId: RP_ID,
            challenge: secondOptions.options.challenge,
          }),
          "corr",
          {
            kind: "additional",
            stepUp: {
              userId: holder.userId,
              credentialId: proof.credentialId,
              verifiedAt: proof.verifiedAt,
            },
          },
        )
      ).ok,
    ).toBe(true);
    const step = await service.stepUpOptions(holder.userId, "corr");
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    const stepped = await service.verifyStepUp(
      holder.userId,
      authenticationResponse(secondAuthenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: step.options.challenge,
        signCount: 1,
      }),
      "corr",
    );
    expect(stepped).toEqual({ ok: false });
    expect(
      (await credentials.findByCredentialId(secondAuthenticator.credentialId))?.activatedAt,
    ).toBeNull();
  });

  it("refuses a fourth pending credential and a duplicate credential id", async () => {
    const userId = await person("cap@example.com");
    for (let index = 0; index < 3; index++) {
      const started = await startRegistration(userId);
      expect(
        (
          await service.verifyRegistration(
            userId,
            registerResponse(started.authenticator, started.options.challenge),
            "corr",
            { kind: "first" },
          )
        ).ok,
      ).toBe(true);
    }
    expect(await service.registrationOptions(userId, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("pending_limit");
    expect(await credentials.countPendingByUser({ userId }, new Date())).toBe(3);

    const duplicateUser = await person("duplicate@example.com");
    const started = await startRegistration(duplicateUser);
    const response = registerResponse(started.authenticator, started.options.challenge);
    expect(
      (await service.verifyRegistration(duplicateUser, response, "corr", { kind: "first" })).ok,
    ).toBe(true);
    const next = await startRegistration(duplicateUser);
    const replay = registrationResponse(started.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: next.options.challenge,
    });
    expect(
      await service.verifyRegistration(duplicateUser, replay, "corr", { kind: "first" }),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("credential_duplicate");
  });

  it("rejects a user handle mismatch and a suspended or deleted account", async () => {
    const enrolled = await enroll("handle-mismatch@example.com");
    const mismatched = await signIn(enrolled.authenticator, 1, { userHandle: randomBytes(32) });
    expect(mismatched.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("user_handle");
    expect(
      (await credentials.findByCredentialId(enrolled.authenticator.credentialId))?.activatedAt,
    ).toBeNull();

    const suspended = await person("suspended@example.com");
    await users.setStatus(suspended, "suspended");
    expect(await service.registrationOptions(suspended, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    const deleted = await enroll("deleted@example.com");
    await users.setStatus(deleted.userId, "deleted");
    expect((await signIn(deleted.authenticator, 1)).result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("account_not_active");
  });

  it("refuses a production configuration with localhost, http or a list, and a missing one, while identity still stores users", async () => {
    const previous = {
      NODE_ENV: process.env["NODE_ENV"],
      WEBAUTHN_ORIGIN: process.env["WEBAUTHN_ORIGIN"],
      WEBAUTHN_RP_ID: process.env["WEBAUTHN_RP_ID"],
    };
    const cases = [
      { WEBAUTHN_ORIGIN: "http://localhost:5174", WEBAUTHN_RP_ID: "localhost" },
      { WEBAUTHN_ORIGIN: "http://console.thesomnus.com", WEBAUTHN_RP_ID: RP_ID },
      { WEBAUTHN_ORIGIN: `${ORIGIN},http://localhost:5174`, WEBAUTHN_RP_ID: RP_ID },
    ];
    try {
      process.env["NODE_ENV"] = "production";
      for (const item of cases) {
        process.env["WEBAUTHN_ORIGIN"] = item.WEBAUTHN_ORIGIN;
        process.env["WEBAUTHN_RP_ID"] = item.WEBAUTHN_RP_ID;
        await expect(
          service.registrationOptions(UUIDv7(), "corr", { kind: "first" }),
        ).rejects.toBeInstanceOf(WebAuthnConfigError);
      }
      delete process.env["WEBAUTHN_ORIGIN"];
      delete process.env["WEBAUTHN_RP_ID"];
      await expect(service.authenticationOptions("corr")).rejects.toBeInstanceOf(
        WebAuthnConfigError,
      );
      const userId = await users.create({ email: "unaffected@example.com" });
      expect((await users.findById(userId))?.status).toBe("active");
    } finally {
      process.env["NODE_ENV"] = previous.NODE_ENV;
      process.env["WEBAUTHN_ORIGIN"] = previous.WEBAUTHN_ORIGIN;
      process.env["WEBAUTHN_RP_ID"] = previous.WEBAUTHN_RP_ID;
    }
  });

  it("registers, activates on the first sign-in, signs in again, and steps up, with no role required", async () => {
    const email = "active-no-role@example.com";
    const userId = await person(email, "firebase-no-role");
    const started = await startRegistration(userId);
    expect(started.handle.length).toBe(32);
    expect(started.options.user.name).toBe(email);
    expect(started.options.user.displayName).toBe(email);
    expect(started.options.user.id.includes("@")).toBe(false);
    expect(started.handle.equals(Buffer.from(userId))).toBe(false);
    expect(started.options.rp.id).toBe(RP_ID);
    expect(started.options.rp.name).toBe("The Somnus");
    expect(started.options.attestation).toBe("none");
    expect(started.options.authenticatorSelection?.residentKey).toBe("required");
    expect(started.options.authenticatorSelection?.userVerification).toBe("required");
    expect(started.options.pubKeyCredParams.map((item) => item.alg)).toEqual([-7, -8, -257]);
    expect(started.options.excludeCredentials).toEqual([]);

    const response = registerResponse(started.authenticator, started.options.challenge);
    const registered = await service.verifyRegistration(userId, response, "corr", {
      kind: "first",
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(Object.keys(registered).sort()).toEqual(["credentialId", "ok"]);
    const pending = await credentials.findByCredentialId(started.authenticator.credentialId);
    expect(pending?.activatedAt).toBeNull();
    expect(pending?.pendingExpiresAt).not.toBeNull();
    expect(pending?.coseAlgorithm).toBe(-7);
    expect(pending?.backupEligible).toBe(true);
    expect(pending?.backupState).toBe(true);
    expect(pending?.aaguid?.length).toBe(16);
    expect(events.some((event) => event.eventType === PASSKEY_EVENTS.registered)).toBe(true);

    const again = await startRegistration(userId);
    expect(again.options.excludeCredentials?.map((item) => item.id)).toContain(
      registered.credentialId,
    );

    const first = await signIn(started.authenticator, 1);
    expect(first.result).toEqual({
      ok: true,
      userId,
      firebaseUid: "firebase-no-role",
      credentialId: registered.credentialId,
      activated: true,
    });
    const second = await signIn(started.authenticator, 2);
    expect(second.result.ok).toBe(true);
    if (second.result.ok) expect(second.result.activated).toBe(false);

    const stepOptions = await service.stepUpOptions(userId, "corr");
    expect(stepOptions.ok).toBe(true);
    if (!stepOptions.ok) return;
    expect(stepOptions.options.userVerification).toBe("required");
    expect(stepOptions.options.allowCredentials?.length).toBeGreaterThan(0);
    const stepped = await service.verifyStepUp(
      userId,
      authenticationResponse(started.authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: stepOptions.options.challenge,
        signCount: 3,
      }),
      "corr",
    );
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    expect(Object.keys(stepped).sort()).toEqual(["credentialId", "ok", "userId", "verifiedAt"]);
    expect(stepped.userId).toBe(userId);
    expect(stepped.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const roles = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, userId));
    expect(roles).toHaveLength(0);
    const zero = await enroll("zero-counter@example.com");
    const stayed = await signIn(zero.authenticator, 0);
    expect(stayed.result.ok).toBe(true);
    if (stayed.result.ok) expect(stayed.result.activated).toBe(true);
    expect(
      (await credentials.findByCredentialId(zero.authenticator.credentialId))?.lockedAt,
    ).toBeNull();
    expect((await signIn(zero.authenticator, 0)).result.ok).toBe(true);
  });

  it("locks a credential whose stored counter is above zero when the assertion sends zero", async () => {
    const enrolled = await enroll("zero-clone@example.com");
    expect((await signIn(enrolled.authenticator, 5)).result.ok).toBe(true);
    events.splice(0, events.length);
    const again = await signIn(enrolled.authenticator, 0);
    expect(again.result).toEqual({ ok: false });
    expect(events.some((event) => event.eventType === PASSKEY_EVENTS.locked)).toBe(true);
    expect(events.some((event) => event.data["reason"] === "sign_count")).toBe(true);
    const row = await credentials.findByCredentialId(enrolled.authenticator.credentialId);
    expect(row?.lockedAt).not.toBeNull();
    expect(row?.signCount).toBe(5);
  });

  it("registers and signs in with RS256 and EdDSA, and refuses an unlisted algorithm", async () => {
    for (const algorithm of ["RS256", "EdDSA"] as const) {
      const userId = await person(`${algorithm.toLowerCase()}@example.com`);
      const options = await service.registrationOptions(userId, "corr", { kind: "first" });
      expect(options.ok).toBe(true);
      if (!options.ok) continue;
      const authenticator = createSoftwareAuthenticator(
        Buffer.from(options.options.user.id, "base64url"),
        algorithm,
      );
      const registered = await service.verifyRegistration(
        userId,
        registrationResponse(authenticator, {
          origin: ORIGIN,
          rpId: RP_ID,
          challenge: options.options.challenge,
        }),
        "corr",
        { kind: "first" },
      );
      expect(registered.ok, algorithm).toBe(true);
      expect(
        (await credentials.findByCredentialId(authenticator.credentialId))?.coseAlgorithm,
      ).toBe(algorithm === "RS256" ? -257 : -8);
      expect((await signIn(authenticator, 1)).result.ok, algorithm).toBe(true);
    }

    const userId = await person("unlisted-alg@example.com");
    const started = await startRegistration(userId);
    const response = registerResponse(started.authenticator, started.options.challenge);
    const attestation = Buffer.from(response.response.attestationObject, "base64url");
    let algAt = -1;
    for (let index = 0; index < attestation.length - 1; index++) {
      if (attestation[index] === 0x03 && attestation[index + 1] === 0x26) algAt = index;
    }
    expect(algAt).toBeGreaterThan(-1);
    attestation[algAt + 1] = 0x0a;
    response.response.attestationObject = attestation.toString("base64url");
    expect(await service.verifyRegistration(userId, response, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("algorithm");
    expect(await credentials.findByCredentialId(started.authenticator.credentialId)).toBeNull();
  });

  it("stores at most three pending credentials when four registrations finish together", async () => {
    const userId = await person("cap-race@example.com");
    const started = [];
    for (let index = 0; index < 4; index++) started.push(await startRegistration(userId));
    const results = await Promise.all(
      started.map((item) =>
        service.verifyRegistration(
          userId,
          registerResponse(item.authenticator, item.options.challenge),
          "corr",
          { kind: "first" },
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(await credentials.countPendingByUser({ userId }, new Date())).toBe(3);
    expect(events.some((event) => event.data["reason"] === "pending_limit")).toBe(true);
  });

  it("refuses a missing user, a missing Firebase uid, another user's step-up, and a malformed body", async () => {
    expect(await service.registrationOptions(UUIDv7(), "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("user_missing");

    const userId = await users.create({ email: "no-firebase@example.com" });
    const started = await startRegistration(userId);
    expect(
      (
        await service.verifyRegistration(
          userId,
          registerResponse(started.authenticator, started.options.challenge),
          "corr",
          { kind: "first" },
        )
      ).ok,
    ).toBe(true);
    const attempt = await signIn(started.authenticator, 1);
    expect(attempt.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("firebase_uid_missing");
    expect(
      (await credentials.findByCredentialId(started.authenticator.credentialId))?.activatedAt,
    ).toBeNull();

    const owner = await enroll("step-owner@example.com");
    expect((await signIn(owner.authenticator, 1)).result.ok).toBe(true);
    const stranger = await enroll("step-stranger@example.com");
    const step = await service.stepUpOptions(owner.userId, "corr");
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    expect(
      await service.verifyStepUp(
        owner.userId,
        authenticationResponse(stranger.authenticator, {
          origin: ORIGIN,
          rpId: RP_ID,
          challenge: step.options.challenge,
          signCount: 1,
        }),
        "corr",
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("credential_user");

    expect(
      await service.verifyRegistration(owner.userId, { type: "public-key" }, "corr", {
        kind: "first",
      }),
    ).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("client_data");
    expect(
      await service.verifyAuthentication(
        { id: "abc", rawId: "abc", type: "public-key", response: { clientDataJSON: "" } },
        "corr",
      ),
    ).toEqual({ ok: false });
  });

  it("lets one of two simultaneous regressions lock the credential", async () => {
    const enrolled = await enroll("double-regression@example.com");
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
    const first = await service.authenticationOptions("corr");
    const second = await service.authenticationOptions("corr");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const results = await Promise.all(
      [first.options.challenge, second.options.challenge].map((challenge) =>
        service.verifyAuthentication(
          authenticationResponse(enrolled.authenticator, {
            origin: ORIGIN,
            rpId: RP_ID,
            challenge,
            signCount: 1,
          }),
          "corr",
        ),
      ),
    );
    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(events.filter((event) => event.eventType === PASSKEY_EVENTS.locked)).toHaveLength(1);
    expect(
      (await credentials.findByCredentialId(enrolled.authenticator.credentialId))?.lockedAt,
    ).not.toBeNull();
  });

  it("moves the use time forward when the stored use time is not earlier", async () => {
    const enrolled = await enroll("same-second@example.com");
    expect((await signIn(enrolled.authenticator, 0)).result.ok).toBe(true);
    await db
      .update(passkeyCredentials)
      .set({ lastUsedAt: new Date(Date.now() + 60_000) })
      .where(eq(passkeyCredentials.credentialId, enrolled.authenticator.credentialId));
    expect((await signIn(enrolled.authenticator, 0)).result.ok).toBe(true);
    await db
      .update(passkeyCredentials)
      .set({ lastUsedAt: null })
      .where(eq(passkeyCredentials.credentialId, enrolled.authenticator.credentialId));
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
  });

  it("refuses a replayed bad ceremony, a reused assertion, and a broken signature", async () => {
    const userId = await person("replay@example.com");
    const started = await startRegistration(userId);
    const badRegistration = registerResponse(started.authenticator, started.options.challenge, {
      origin: "https://evil.example",
    });
    expect(
      await service.verifyRegistration(userId, badRegistration, "corr", { kind: "first" }),
    ).toEqual({
      ok: false,
    });
    expect(
      await service.verifyRegistration(userId, badRegistration, "corr", { kind: "first" }),
    ).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_rejected");

    const enrolled = await enroll("replay-auth@example.com");
    const badSignIn = await signIn(enrolled.authenticator, 1, { origin: "https://evil.example" });
    expect(badSignIn.result).toEqual({ ok: false });
    expect(await service.verifyAuthentication(badSignIn.response, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_rejected");

    const reused = await signIn(enrolled.authenticator, 1);
    expect(reused.result.ok).toBe(true);
    expect(await service.verifyAuthentication(reused.response, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_rejected");

    const fresh = await service.authenticationOptions("corr");
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const forged = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: fresh.options.challenge,
      signCount: 2,
    });
    const signature = Buffer.from(forged.response.signature, "base64url");
    signature[signature.length - 1] ^= 0x01;
    forged.response.signature = signature.toString("base64url");
    expect(await service.verifyAuthentication(forged, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("verification_rejected");
    expect(
      (await credentials.findByCredentialId(enrolled.authenticator.credentialId))?.lockedAt,
    ).toBeNull();
  });

  it("refuses a suspended account during a ceremony and a credential whose algorithm was replaced", async () => {
    const userId = await person("mid-ceremony@example.com");
    const started = await startRegistration(userId);
    await users.setStatus(userId, "suspended");
    expect(
      await service.verifyRegistration(
        userId,
        registerResponse(started.authenticator, started.options.challenge),
        "corr",
        { kind: "first" },
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("account_not_active");
    expect(await credentials.findByCredentialId(started.authenticator.credentialId)).toBeNull();

    const enrolled = await enroll("stored-alg@example.com");
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
    await users.setStatus(enrolled.userId, "suspended");
    expect(await service.stepUpOptions(enrolled.userId, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("account_not_active");
    await users.setStatus(enrolled.userId, "active");

    await db
      .update(passkeyCredentials)
      .set({ coseAlgorithm: 10 })
      .where(eq(passkeyCredentials.credentialId, enrolled.authenticator.credentialId));
    const rejected = await signIn(enrolled.authenticator, 2);
    expect(rejected.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("algorithm");
    expect(
      (await credentials.findByCredentialId(enrolled.authenticator.credentialId))?.lockedAt,
    ).toBeNull();
  });

  it("lets one of two simultaneous step-ups win and one duplicate credential id lose", async () => {
    const enrolled = await enroll("step-race@example.com");
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
    const first = await service.stepUpOptions(enrolled.userId, "corr");
    const second = await service.stepUpOptions(enrolled.userId, "corr");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const results = await Promise.all(
      [first.options.challenge, second.options.challenge].map((challenge) =>
        service.verifyStepUp(
          enrolled.userId,
          authenticationResponse(enrolled.authenticator, {
            origin: ORIGIN,
            rpId: RP_ID,
            challenge,
            signCount: 2,
          }),
          "corr",
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(events.some((event) => event.data["reason"] === "counter_race")).toBe(true);

    const userId = await person("duplicate-race@example.com");
    const options = await Promise.all([
      service.registrationOptions(userId, "corr", { kind: "first" }),
      service.registrationOptions(userId, "corr", { kind: "first" }),
    ]);
    expect(options[0]?.ok && options[1]?.ok).toBe(true);
    if (!options[0]?.ok || !options[1]?.ok) return;
    const authenticator = createSoftwareAuthenticator(
      Buffer.from(options[0].options.user.id, "base64url"),
    );
    const stored = await Promise.all(
      options.map((item) =>
        service.verifyRegistration(
          userId,
          item.ok
            ? registerResponse(authenticator, item.options.challenge)
            : registerResponse(authenticator, ""),
          "corr",
          { kind: "first" },
        ),
      ),
    );
    expect(stored.filter((result) => result.ok)).toHaveLength(1);
    expect(stored.filter((result) => !result.ok)).toHaveLength(1);
    expect(events.some((event) => event.data["reason"] === "credential_duplicate")).toBe(true);
  });

  it("refuses malformed ceremony bodies and ignores unknown transports", async () => {
    const userId = await person("malformed@example.com");
    const bodies: unknown[] = [
      null,
      { type: "public-key", response: {} },
      { type: "password", response: {} },
      { type: "public-key", id: 1, response: {} },
      { type: "public-key", id: "abc", rawId: 1, response: {} },
      {
        type: "public-key",
        id: "abc",
        rawId: "abc",
        response: { clientDataJSON: 1, attestationObject: "abc" },
      },
      {
        type: "public-key",
        id: "abc",
        rawId: "abc",
        response: { clientDataJSON: "abc", attestationObject: 1 },
      },
      {
        type: "public-key",
        id: "abc",
        rawId: "abc",
        response: { clientDataJSON: "!!!!", attestationObject: "abc" },
      },
    ];
    for (const body of bodies) {
      expect(await service.verifyRegistration(userId, body, "   ", { kind: "first" })).toEqual({
        ok: false,
      });
    }
    const assertions: unknown[] = [
      "nope",
      { type: "password", response: {} },
      { type: "public-key", id: 1, response: {} },
      {
        type: "public-key",
        id: "abc",
        rawId: "abc",
        response: { clientDataJSON: 1, authenticatorData: "abc", signature: "abc" },
      },
      {
        type: "public-key",
        id: "abc",
        rawId: "abc",
        response: { clientDataJSON: "abc", authenticatorData: "abc", signature: 1 },
      },
    ];
    for (const body of assertions) {
      expect(await service.verifyAuthentication(body, "corr")).toEqual({ ok: false });
    }

    const started = await startRegistration(userId);
    const bogus = registerResponse(started.authenticator, started.options.challenge);
    bogus.response.transports = ["not-a-transport"];
    expect((await service.verifyRegistration(userId, bogus, "corr", { kind: "first" })).ok).toBe(
      true,
    );
    expect(
      (await credentials.findByCredentialId(started.authenticator.credentialId))?.transports,
    ).toBeNull();

    const again = await startRegistration(userId);
    const named = registerResponse(again.authenticator, again.options.challenge);
    named.response.transports = ["internal"];
    expect((await service.verifyRegistration(userId, named, "corr", { kind: "first" })).ok).toBe(
      true,
    );
    const listed = await service.registrationOptions(userId, "corr", { kind: "first" });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.options.excludeCredentials?.some((item) => item.transports?.length)).toBe(true);
    }

    const broken = await startRegistration(userId);
    const attestation = registerResponse(broken.authenticator, broken.options.challenge);
    const packed = Buffer.from(attestation.response.attestationObject, "base64url");
    const fmtAt = packed.indexOf(Buffer.from("none", "utf8"));
    expect(fmtAt).toBeGreaterThan(-1);
    packed.set(Buffer.from("pack", "utf8"), fmtAt);
    attestation.response.attestationObject = packed.toString("base64url");
    expect(
      await service.verifyRegistration(userId, attestation, "corr", { kind: "first" }),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("verification_rejected");
    expect(await credentials.findByCredentialId(broken.authenticator.credentialId)).toBeNull();

    const short = await startRegistration(userId);
    const clipped = registerResponse(short.authenticator, short.options.challenge);
    clipped.response.attestationObject = Buffer.from("too-short").toString("base64url");
    expect(await service.verifyRegistration(userId, clipped, "corr", { kind: "first" })).toEqual({
      ok: false,
    });

    const missingHandle = await enroll("no-handle@example.com");
    const handle = await signIn(missingHandle.authenticator, 1, { userHandle: null });
    expect(handle.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("user_handle");

    const active = await enroll("past-use@example.com");
    expect((await signIn(active.authenticator, 1)).result.ok).toBe(true);
    await db
      .update(passkeyCredentials)
      .set({ lastUsedAt: new Date(Date.now() - 5_000) })
      .where(eq(passkeyCredentials.credentialId, active.authenticator.credentialId));
    expect((await signIn(active.authenticator, 2)).result.ok).toBe(true);
  });

  it("refuses an id that differs from rawId and fields larger than the ceremony caps", async () => {
    const userId = await person("caps@example.com");
    const mismatched = await startRegistration(userId);
    const mismatch = registerResponse(mismatched.authenticator, mismatched.options.challenge);
    mismatch.rawId = "AAAA";
    expect(await service.verifyRegistration(userId, mismatch, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("client_data");

    const tooLong = (maxBytes: number) => {
      const groups = Math.floor(maxBytes / 3);
      const rest = maxBytes % 3;
      return "A".repeat(groups * 4 + (rest === 0 ? 0 : rest + 1) + 1);
    };
    const client = await startRegistration(userId);
    const clientBody = registerResponse(client.authenticator, client.options.challenge);
    clientBody.response.clientDataJSON = tooLong(PASSKEY_SIZE_LIMITS.clientDataJson);
    expect(await service.verifyRegistration(userId, clientBody, "corr", { kind: "first" })).toEqual(
      { ok: false },
    );
    expect(events.at(-1)?.data["reason"]).toBe("client_data");

    const attestation = await startRegistration(userId);
    const attestationBody = registerResponse(
      attestation.authenticator,
      attestation.options.challenge,
    );
    attestationBody.response.attestationObject = tooLong(PASSKEY_SIZE_LIMITS.attestationObject);
    expect(
      await service.verifyRegistration(userId, attestationBody, "corr", { kind: "first" }),
    ).toEqual({ ok: false });

    const identifier = await startRegistration(userId);
    const identifierBody = registerResponse(identifier.authenticator, identifier.options.challenge);
    const longId = tooLong(PASSKEY_SIZE_LIMITS.credentialId);
    identifierBody.id = longId;
    identifierBody.rawId = longId;
    expect(
      await service.verifyRegistration(userId, identifierBody, "corr", { kind: "first" }),
    ).toEqual({ ok: false });

    const enrolled = await enroll("caps-auth@example.com");
    const options = await service.authenticationOptions("corr");
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const assertion = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: options.options.challenge,
      signCount: 1,
    });
    assertion.response.authenticatorData = tooLong(PASSKEY_SIZE_LIMITS.authenticatorData);
    expect(await service.verifyAuthentication(assertion, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("client_data");

    const signatureOptions = await service.authenticationOptions("corr");
    expect(signatureOptions.ok).toBe(true);
    if (!signatureOptions.ok) return;
    const signed = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: signatureOptions.options.challenge,
      signCount: 1,
    });
    signed.response.signature = tooLong(PASSKEY_SIZE_LIMITS.signature);
    expect(await service.verifyAuthentication(signed, "corr")).toEqual({ ok: false });

    const handleOptions = await service.authenticationOptions("corr");
    expect(handleOptions.ok).toBe(true);
    if (!handleOptions.ok) return;
    const handled = authenticationResponse(enrolled.authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: handleOptions.options.challenge,
      signCount: 1,
    });
    handled.response.userHandle = tooLong(PASSKEY_SIZE_LIMITS.userHandle);
    expect(await service.verifyAuthentication(handled, "corr")).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("client_data");
  });

  it("refuses a first registration once an active credential exists, and allows one with only pending credentials", async () => {
    const userId = await person("pending-only@example.com");
    const first = await startRegistration(userId);
    expect(
      (
        await service.verifyRegistration(
          userId,
          registerResponse(first.authenticator, first.options.challenge),
          "corr",
          { kind: "first" },
        )
      ).ok,
    ).toBe(true);
    const second = await startRegistration(userId);
    expect(
      (
        await service.verifyRegistration(
          userId,
          registerResponse(second.authenticator, second.options.challenge),
          "corr",
          { kind: "first" },
        )
      ).ok,
    ).toBe(true);
    const third = await service.registrationOptions(userId, "corr", { kind: "first" });
    expect(third.ok).toBe(true);

    const active = await enroll("already-active@example.com");
    expect((await signIn(active.authenticator, 1)).result.ok).toBe(true);
    expect(await service.registrationOptions(active.userId, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("enrollment");
  });

  it("refuses an additional registration without a fresh step-up of that user's active credential", async () => {
    const owner = await enroll("additional-owner@example.com");
    expect((await signIn(owner.authenticator, 1)).result.ok).toBe(true);
    expect(
      await service.registrationOptions(owner.userId, "corr", { kind: "additional" } as never),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("enrollment");

    const step = await service.stepUpOptions(owner.userId, "corr");
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    const proved = await service.verifyStepUp(
      owner.userId,
      authenticationResponse(owner.authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: step.options.challenge,
        signCount: 2,
      }),
      "corr",
    );
    expect(proved.ok).toBe(true);
    if (!proved.ok) return;

    const stale = {
      kind: "additional" as const,
      stepUp: {
        userId: owner.userId,
        credentialId: proved.credentialId,
        verifiedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      },
    };
    expect(await service.registrationOptions(owner.userId, "corr", stale)).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("enrollment");

    const future = {
      kind: "additional" as const,
      stepUp: {
        userId: owner.userId,
        credentialId: proved.credentialId,
        verifiedAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    expect(await service.registrationOptions(owner.userId, "corr", future)).toEqual({
      ok: false,
    });

    const stranger = await enroll("additional-stranger@example.com");
    expect((await signIn(stranger.authenticator, 1)).result.ok).toBe(true);
    const foreign = await service.stepUpOptions(stranger.userId, "corr");
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    const foreignProof = await service.verifyStepUp(
      stranger.userId,
      authenticationResponse(stranger.authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: foreign.options.challenge,
        signCount: 2,
      }),
      "corr",
    );
    expect(foreignProof.ok).toBe(true);
    if (!foreignProof.ok) return;
    expect(
      await service.registrationOptions(owner.userId, "corr", {
        kind: "additional",
        stepUp: {
          userId: owner.userId,
          credentialId: foreignProof.credentialId,
          verifiedAt: foreignProof.verifiedAt,
        },
      }),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("enrollment");

    expect(
      await credentials.revoke(
        { userId: owner.userId },
        owner.authenticator.credentialId,
        new Date(),
      ),
    ).toBe(true);
    expect(
      await service.registrationOptions(owner.userId, "corr", {
        kind: "additional",
        stepUp: {
          userId: owner.userId,
          credentialId: proved.credentialId,
          verifiedAt: proved.verifiedAt,
        },
      }),
    ).toEqual({ ok: false });

    const locked = await enroll("additional-locked@example.com");
    expect((await signIn(locked.authenticator, 1)).result.ok).toBe(true);
    const lockedStep = await service.stepUpOptions(locked.userId, "corr");
    expect(lockedStep.ok).toBe(true);
    if (!lockedStep.ok) return;
    const lockedProof = await service.verifyStepUp(
      locked.userId,
      authenticationResponse(locked.authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: lockedStep.options.challenge,
        signCount: 2,
      }),
      "corr",
    );
    expect(lockedProof.ok).toBe(true);
    if (!lockedProof.ok) return;
    expect(
      await credentials.lock(
        { userId: locked.userId },
        locked.authenticator.credentialId,
        new Date(),
      ),
    ).toBe(true);
    expect(
      await service.registrationOptions(locked.userId, "corr", {
        kind: "additional",
        stepUp: {
          userId: locked.userId,
          credentialId: lockedProof.credentialId,
          verifiedAt: lockedProof.verifiedAt,
        },
      }),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("enrollment");
  });

  it("refuses a first registration when a credential is activated after the options were built", async () => {
    const userId = await person("activated-between@example.com");
    const pending = await startRegistration(userId);
    expect(
      (
        await service.verifyRegistration(
          userId,
          registerResponse(pending.authenticator, pending.options.challenge),
          "corr",
          { kind: "first" },
        )
      ).ok,
    ).toBe(true);
    const next = await startRegistration(userId);
    expect((await signIn(pending.authenticator, 1)).result.ok).toBe(true);
    expect(
      await service.verifyRegistration(
        userId,
        registerResponse(next.authenticator, next.options.challenge),
        "corr",
        { kind: "first" },
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("enrollment");
    expect(await credentials.findByCredentialId(next.authenticator.credentialId)).toBeNull();
  });

  it("allows a step-up without a user handle, and never writes a handle during verification", async () => {
    const enrolled = await enroll("step-no-handle@example.com");
    expect((await signIn(enrolled.authenticator, 1)).result.ok).toBe(true);
    const step = await service.stepUpOptions(enrolled.userId, "corr");
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    expect(
      (
        await service.verifyStepUp(
          enrolled.userId,
          authenticationResponse(enrolled.authenticator, {
            origin: ORIGIN,
            rpId: RP_ID,
            challenge: step.options.challenge,
            signCount: 2,
            userHandle: null,
          }),
          "corr",
        )
      ).ok,
    ).toBe(true);
    const mismatch = await service.stepUpOptions(enrolled.userId, "corr");
    expect(mismatch.ok).toBe(true);
    if (!mismatch.ok) return;
    expect(
      await service.verifyStepUp(
        enrolled.userId,
        authenticationResponse(enrolled.authenticator, {
          origin: ORIGIN,
          rpId: RP_ID,
          challenge: mismatch.options.challenge,
          signCount: 3,
          userHandle: randomBytes(32),
        }),
        "corr",
      ),
    ).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("user_handle");

    await db.delete(passkeyUserHandles).where(eq(passkeyUserHandles.userId, enrolled.userId));
    const attempt = await signIn(enrolled.authenticator, 4);
    expect(attempt.result).toEqual({ ok: false });
    expect(events.at(-1)?.data["reason"]).toBe("user_handle");
    expect(
      await db
        .select()
        .from(passkeyUserHandles)
        .where(eq(passkeyUserHandles.userId, enrolled.userId)),
    ).toHaveLength(0);
  });

  it("burns the challenge and returns a failure when parsing throws", async () => {
    const userId = await person("parser-throw@example.com");
    const started = await startRegistration(userId);
    const response = registerResponse(started.authenticator, started.options.challenge);
    const spy = vi.spyOn(ceremony, "extractAttestedAuthenticatorData").mockImplementation(() => {
      throw new Error("parser blew up");
    });
    try {
      await expect(
        service.verifyRegistration(userId, response, "corr", { kind: "first" }),
      ).resolves.toEqual({ ok: false });
    } finally {
      spy.mockRestore();
    }
    expect(events.at(-1)?.data["reason"]).toBe("client_data");
    expect(await service.verifyRegistration(userId, response, "corr", { kind: "first" })).toEqual({
      ok: false,
    });
    expect(events.at(-1)?.data["reason"]).toBe("challenge_rejected");
  });

  it("keeps a successful ceremony when the audit publisher throws or never resolves", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const throwing = new PasskeyWebAuthnService(credentials, challenges, handles, users, {
        publish: async () => {
          throw new Error("challenge-must-not-be-logged");
        },
      });
      const thrownUser = await person("audit-throw@example.com");
      const thrown = await startRegistration(thrownUser);
      expect(
        (
          await throwing.verifyRegistration(
            thrownUser,
            registerResponse(thrown.authenticator, thrown.options.challenge),
            "corr",
            { kind: "first" },
          )
        ).ok,
      ).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("passkey audit publish failed");

      warn.mockClear();
      const hanging = new PasskeyWebAuthnService(credentials, challenges, handles, users, {
        publish: () => new Promise(() => undefined),
      });
      const hungUser = await person("audit-hang@example.com");
      const hung = await startRegistration(hungUser);
      expect(
        (
          await hanging.verifyRegistration(
            hungUser,
            registerResponse(hung.authenticator, hung.options.challenge),
            "corr",
            { kind: "first" },
          )
        ).ok,
      ).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("passkey audit publish failed");
    } finally {
      warn.mockRestore();
    }
  });
});
