import { createHash, randomBytes } from "node:crypto";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { describe, expect, it } from "vitest";
import {
  attestedAaguid,
  attestedCredentialAlgorithm,
  attestedCredentialId,
  authenticatorDataProblem,
  classifyUnconsumedChallenge,
  coseAlgorithm,
  extractAttestedAuthenticatorData,
  inspectClientData,
  isAllowedCoseAlgorithm,
  isPasskeyFailureCode,
  readAuthenticatorData,
  rpIdHashMatches,
  sameBytes,
} from "../../src/domain/passkey/webauthn-ceremony.js";
import {
  authenticationResponse,
  createSoftwareAuthenticator,
  registrationResponse,
} from "../support/webauthn-authenticator.js";

const ORIGIN = "https://console.thesomnus.com";
const RP_ID = "console.thesomnus.com";

describe("CBOR reader", () => {
  it("rejects a repeated map key and a nest deeper than 8 without throwing", () => {
    const duplicate = Buffer.from([0xa2, 0x03, 0x26, 0x03, 0x26]);
    expect(() => coseAlgorithm(duplicate)).not.toThrow();
    expect(coseAlgorithm(duplicate)).toBeNull();

    const nested = (count: number) => {
      let current = Buffer.from([0x00]);
      for (let index = 0; index < count; index++) {
        current = Buffer.concat([Buffer.from([0x81]), current]);
      }
      return Buffer.concat([Buffer.from([0xa2, 0x03, 0x26, 0x00]), current]);
    };
    expect(coseAlgorithm(nested(7))).toBe(-7);
    expect(coseAlgorithm(nested(8))).toBeNull();

    expect(() => coseAlgorithm(Buffer.from([0xff, 0x1a]))).not.toThrow();
    expect(coseAlgorithm(Buffer.from([0xff]))).toBeNull();
    expect(extractAttestedAuthenticatorData(Buffer.alloc(0))).toBeNull();
    expect(attestedCredentialAlgorithm(Buffer.alloc(4))).toBeNull();
    expect(readAuthenticatorData(Buffer.alloc(2))).toBeNull();
    expect(() =>
      inspectClientData(Buffer.from("{"), { type: "webauthn.get", origin: ORIGIN }),
    ).not.toThrow();
    expect(inspectClientData(Buffer.from("{"), { type: "webauthn.get", origin: ORIGIN }).ok).toBe(
      false,
    );
    expect(authenticatorDataProblem(Buffer.alloc(2), RP_ID).ok).toBe(false);
  });
});

describe("software authenticator", () => {
  it("produces a registration and an assertion the server library accepts", async () => {
    const handle = randomBytes(32);
    const authenticator = createSoftwareAuthenticator(handle);
    const challenge = randomBytes(32).toString("base64url");
    const registered = await verifyRegistrationResponse({
      response: registrationResponse(authenticator, { origin: ORIGIN, rpId: RP_ID, challenge }),
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -8, -257],
    });
    expect(registered.verified).toBe(true);
    if (!registered.verified) return;
    expect(registered.registrationInfo.fmt).toBe("none");
    expect(coseAlgorithm(Buffer.from(registered.registrationInfo.credential.publicKey))).toBe(-7);

    const next = randomBytes(32).toString("base64url");
    const asserted = await verifyAuthenticationResponse({
      response: authenticationResponse(authenticator, {
        origin: ORIGIN,
        rpId: RP_ID,
        challenge: next,
        signCount: 1,
      }),
      expectedChallenge: next,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: registered.registrationInfo.credential.id,
        publicKey: registered.registrationInfo.credential.publicKey,
        counter: 0,
      },
    });
    expect(asserted.verified).toBe(true);
    expect(asserted.authenticationInfo.newCounter).toBe(1);
  });

  it.each(["RS256", "EdDSA"] as const)(
    "produces a %s registration and assertion the server library accepts",
    async (algorithm) => {
      const authenticator = createSoftwareAuthenticator(randomBytes(32), algorithm);
      const challenge = randomBytes(32).toString("base64url");
      const registered = await verifyRegistrationResponse({
        response: registrationResponse(authenticator, { origin: ORIGIN, rpId: RP_ID, challenge }),
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -8, -257],
      });
      expect(registered.verified).toBe(true);
      if (!registered.verified) return;
      const next = randomBytes(32).toString("base64url");
      const asserted = await verifyAuthenticationResponse({
        response: authenticationResponse(authenticator, {
          origin: ORIGIN,
          rpId: RP_ID,
          challenge: next,
          signCount: 1,
        }),
        expectedChallenge: next,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: {
          id: registered.registrationInfo.credential.id,
          publicKey: registered.registrationInfo.credential.publicKey,
          counter: 0,
        },
      });
      expect(asserted.verified).toBe(true);
    },
  );
});

describe("inspectClientData", () => {
  function encoded(body: Record<string, unknown>): Buffer {
    return Buffer.from(JSON.stringify(body), "utf8");
  }

  const challenge = randomBytes(32).toString("base64url");

  it("rejects origin tricks by exact string match", () => {
    for (const origin of [
      "https://evil.example",
      "https://console.thesomnus.com.example",
      "https://example.com/console.thesomnus.com",
      "http://console.thesomnus.com",
      "https://console.thesomnus.com:443",
      "https://console.thesomnus.com.",
      "https://Console.thesomnus.com",
    ]) {
      const result = inspectClientData(
        encoded({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
        { type: "webauthn.get", origin: ORIGIN },
      );
      expect(result.ok, origin).toBe(false);
      if (!result.ok) expect(result.code).toBe("origin");
    }
  });

  it("rejects crossOrigin true and any topOrigin, and keeps the challenge so it can be burned", () => {
    const cross = inspectClientData(
      encoded({ type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: true }),
      { type: "webauthn.create", origin: ORIGIN },
    );
    expect(cross.ok).toBe(false);
    if (!cross.ok) {
      expect(cross.code).toBe("cross_origin");
      expect(cross.challenge?.length).toBe(32);
    }
    const top = inspectClientData(
      encoded({
        type: "webauthn.get",
        challenge,
        origin: ORIGIN,
        crossOrigin: false,
        topOrigin: ORIGIN,
      }),
      { type: "webauthn.get", origin: ORIGIN },
    );
    expect(top.ok).toBe(false);
    if (!top.ok) expect(top.code).toBe("top_origin");
  });

  it("rejects user verification and a foreign rpId from the authenticator data flags", () => {
    const hash = createHash("sha256").update(RP_ID, "utf8").digest();
    const flags = (value: number) => Buffer.concat([hash, Buffer.from([value, 0, 0, 0, 0])]);
    expect(authenticatorDataProblem(flags(0x01), RP_ID).ok).toBe(false);
    const present = authenticatorDataProblem(flags(0x01), RP_ID);
    if (!present.ok) expect(present.code).toBe("user_verification");
    const foreign = createHash("sha256").update("example.com", "utf8").digest();
    const wrong = authenticatorDataProblem(
      Buffer.concat([foreign, Buffer.from([0x1d, 0, 0, 0, 0])]),
      RP_ID,
    );
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("rp_id");
    expect(authenticatorDataProblem(Buffer.alloc(4), RP_ID).ok).toBe(false);
  });

  it("classifies an unconsumed challenge without returning its bytes", () => {
    const now = new Date("2026-11-11T12:00:00.000Z");
    expect(
      classifyUnconsumedChallenge(null, { purpose: "authentication", userId: null, now }),
    ).toBe("challenge_rejected");
    expect(
      classifyUnconsumedChallenge(
        {
          purpose: "registration",
          userId: "user-a",
          expiresAt: new Date("2026-11-11T13:00:00.000Z"),
        },
        { purpose: "authentication", userId: null, now },
      ),
    ).toBe("challenge_purpose");
    expect(
      classifyUnconsumedChallenge(
        {
          purpose: "registration",
          userId: "user-a",
          expiresAt: new Date("2026-11-11T13:00:00.000Z"),
        },
        { purpose: "registration", userId: "user-b", now },
      ),
    ).toBe("challenge_user");
    expect(
      classifyUnconsumedChallenge(
        {
          purpose: "authentication",
          userId: null,
          expiresAt: new Date("2026-11-11T11:00:00.000Z"),
        },
        { purpose: "authentication", userId: null, now },
      ),
    ).toBe("challenge_expired");
  });

  it("reads authData out of an attestation object and ignores a truncated one", () => {
    const authenticator = createSoftwareAuthenticator(randomBytes(32));
    const response = registrationResponse(authenticator, {
      origin: ORIGIN,
      rpId: RP_ID,
      challenge: randomBytes(32).toString("base64url"),
    });
    const attestation = Buffer.from(response.response.attestationObject, "base64url");
    const authData = extractAttestedAuthenticatorData(attestation);
    expect(authData).not.toBeNull();
    expect(authData?.length ?? 0).toBeGreaterThan(37);
    expect(extractAttestedAuthenticatorData(Buffer.alloc(0))).toBeNull();
    expect(coseAlgorithm(Buffer.from([0xff]))).toBeNull();
    expect(isPasskeyFailureCode("origin")).toBe(true);
    expect(isPasskeyFailureCode("free text")).toBe(false);
    expect(isAllowedCoseAlgorithm(-7)).toBe(true);
    expect(isAllowedCoseAlgorithm(-8)).toBe(true);
    expect(isAllowedCoseAlgorithm(-257)).toBe(true);
    expect(isAllowedCoseAlgorithm(0)).toBe(false);
  });

  it("rejects malformed client data before a challenge exists, and accepts one without crossOrigin", () => {
    const challenge = randomBytes(32).toString("base64url");
    const expected = { type: "webauthn.get" as const, origin: ORIGIN };
    for (const body of ["{", "null", "[]", "42"]) {
      const result = inspectClientData(Buffer.from(body), expected);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.challenge).toBeNull();
    }
    expect(
      inspectClientData(encoded({ type: "webauthn.create", challenge, origin: ORIGIN }), expected)
        .ok,
    ).toBe(false);
    expect(
      inspectClientData(encoded({ type: "webauthn.get", challenge: 1, origin: ORIGIN }), expected)
        .ok,
    ).toBe(false);
    expect(
      inspectClientData(
        encoded({ type: "webauthn.get", challenge: "not base64!!", origin: ORIGIN }),
        expected,
      ).ok,
    ).toBe(false);
    expect(
      inspectClientData(
        encoded({ type: "webauthn.get", challenge: "YQ", origin: ORIGIN }),
        expected,
      ).ok,
    ).toBe(false);
    const originType = inspectClientData(
      encoded({ type: "webauthn.get", challenge, origin: 1 }),
      expected,
    );
    expect(originType.ok).toBe(false);
    if (!originType.ok) expect(originType.challenge?.length).toBe(32);
    const oddFlag = inspectClientData(
      encoded({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: "yes" }),
      expected,
    );
    expect(oddFlag.ok).toBe(false);
    if (!oddFlag.ok) expect(oddFlag.code).toBe("client_data");
    const clean = inspectClientData(
      encoded({ type: "webauthn.get", challenge, origin: ORIGIN }),
      expected,
    );
    expect(clean.ok).toBe(true);
  });

  it("checks rpId length, user presence, and attested credential bounds", () => {
    const hash = createHash("sha256").update(RP_ID, "utf8").digest();
    expect(rpIdHashMatches(Buffer.alloc(3), RP_ID)).toBe(false);
    expect(rpIdHashMatches(hash, RP_ID)).toBe(true);
    expect(sameBytes(Buffer.from([1]), Buffer.from([1, 2]))).toBe(false);
    expect(sameBytes(hash, hash)).toBe(true);
    const flags = (value: number) => Buffer.concat([hash, Buffer.from([value, 0, 0, 0, 1])]);
    const present = authenticatorDataProblem(flags(0x04), RP_ID);
    expect(present.ok).toBe(false);
    if (!present.ok) expect(present.code).toBe("user_present");
    const ok = authenticatorDataProblem(flags(0x05), RP_ID);
    expect(ok.ok).toBe(true);
    expect(attestedCredentialId(flags(0x05))).toBeNull();
    expect(attestedAaguid(flags(0x05))).toBeNull();
    const at = Buffer.concat([flags(0x45), Buffer.alloc(16), Buffer.from([0x00, 0x00])]);
    expect(attestedCredentialId(at)).toBeNull();
    const overflow = Buffer.concat([flags(0x45), Buffer.alloc(16), Buffer.from([0x00, 0x20])]);
    expect(attestedCredentialId(overflow)).toBeNull();
    const aaguid = Buffer.alloc(16, 7);
    const credentialId = Buffer.from([9, 8, 7]);
    const attested = Buffer.concat([
      flags(0x45),
      aaguid,
      Buffer.from([0x00, credentialId.length]),
      credentialId,
    ]);
    expect(attestedAaguid(attested)?.equals(aaguid)).toBe(true);
    expect(attestedCredentialId(attested)?.equals(credentialId)).toBe(true);
  });

  it("refuses CBOR the attestation parser cannot trust", () => {
    const refuse = [
      Buffer.from([0x80]),
      Buffer.from([0xa0]),
      Buffer.from([0x81]),
      Buffer.from([0x81, 0x01]),
      Buffer.from([0xa1, 0x01]),
      Buffer.from([0xa1, 0x01, 0xf4]),
      Buffer.from([0xa1, 0x01, 0xf5]),
      Buffer.from([0xa1, 0x01, 0xf6]),
      Buffer.from([0xa1, 0x01, 0xf7]),
      Buffer.from([0x61, 0x41]),
      Buffer.from([0x62, 0x41]),
      Buffer.from([0x42, 0x01]),
      Buffer.from([0x58]),
      Buffer.from([0x59, 0x00]),
      Buffer.from([0x5a, 0x00, 0x00]),
      Buffer.from([0x5f]),
      Buffer.from([0xe0]),
      Buffer.from([0x5a, 0x00, 0x00, 0x00, 0x01, 0xff]),
    ];
    for (const input of refuse) {
      expect(extractAttestedAuthenticatorData(input)).toBeNull();
    }
    const short = Buffer.concat([
      Buffer.from([0xa1, 0x68]),
      Buffer.from("authData"),
      Buffer.from([0x41, 0x00]),
    ]);
    expect(extractAttestedAuthenticatorData(short)).toBeNull();
    const textAuth = Buffer.concat([
      Buffer.from([0xa1, 0x68]),
      Buffer.from("authData"),
      Buffer.from([0x61, 0x41]),
    ]);
    expect(extractAttestedAuthenticatorData(textAuth)).toBeNull();
    const long = Buffer.alloc(256, 1);
    const head = Buffer.alloc(3);
    head[0] = 0x59;
    head.writeUInt16BE(long.length, 1);
    const wide = Buffer.concat([Buffer.from([0xa1, 0x68]), Buffer.from("authData"), head, long]);
    expect(extractAttestedAuthenticatorData(wide)?.length).toBe(256);
    expect(coseAlgorithm(Buffer.from([0xa1, 0x03, 0x61, 0x78]))).toBeNull();
    expect(coseAlgorithm(Buffer.from([0xa1, 0x01, 0x02]))).toBeNull();
    expect(coseAlgorithm(Buffer.from([0xa1, 0x03, 0x26]))).toBe(-7);
    const now = new Date("2026-11-11T12:00:00.000Z");
    expect(
      classifyUnconsumedChallenge(
        {
          purpose: "authentication",
          userId: null,
          expiresAt: new Date("2026-11-11T13:00:00.000Z"),
        },
        { purpose: "authentication", userId: null, now },
      ),
    ).toBe("challenge_rejected");
  });
});
