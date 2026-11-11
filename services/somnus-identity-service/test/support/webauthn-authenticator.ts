import {
  constants,
  createHash,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * A software authenticator for tests. It lives under test support and is
 * not imported by production code. ES256, RS256 and Ed25519, attestation
 * none, no browser.
 *
 * clientDataJSON carries type, challenge, origin and crossOrigin.
 * authenticatorData carries rpIdHash, the UP/UV/BE/BS flags and the counter.
 */

export type SoftwareAuthenticator = {
  credentialId: Buffer;
  handle: Buffer;
  aaguid: Buffer;
  privateKey: KeyObject;
  cosePublicKey: Buffer;
};

export type CeremonyShape = {
  origin: string;
  rpId: string;
  challenge: string;
  crossOrigin?: boolean;
  topOrigin?: string;
  userVerified?: boolean;
  userPresent?: boolean;
  signCount?: number;
  backupEligible?: boolean;
  backupState?: boolean;
};

export type AuthenticatorAlgorithm = "ES256" | "RS256" | "EdDSA";

export function createSoftwareAuthenticator(
  handle: Buffer,
  algorithm: AuthenticatorAlgorithm = "ES256",
): SoftwareAuthenticator {
  const { publicKey, privateKey } = generateKey(algorithm);
  return {
    credentialId: randomBytes(16),
    handle,
    aaguid: Buffer.from("00112233445566778899aabbccddeeff", "hex"),
    privateKey,
    cosePublicKey: cosePublicKey(algorithm, publicKey),
  };
}

export function registrationResponse(authenticator: SoftwareAuthenticator, shape: CeremonyShape) {
  const client = clientData("webauthn.create", shape);
  const data = authenticatorData(authenticator, shape, true);
  const attestation = Buffer.concat([
    header(5, 3),
    text("fmt"),
    text("none"),
    text("attStmt"),
    header(5, 0),
    text("authData"),
    bytes(data),
  ]);
  return {
    id: b64(authenticator.credentialId),
    rawId: b64(authenticator.credentialId),
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(client),
      attestationObject: b64(attestation),
      transports: ["internal", "hybrid"],
    },
  };
}

export function authenticationResponse(
  authenticator: SoftwareAuthenticator,
  shape: CeremonyShape & { userHandle?: Buffer | null },
) {
  const client = clientData("webauthn.get", shape);
  const data = authenticatorData(authenticator, shape, false);
  const signature = signAssertion(
    authenticator.privateKey,
    Buffer.concat([data, createHash("sha256").update(client).digest()]),
  );
  const userHandle =
    shape.userHandle === null ? undefined : b64(shape.userHandle ?? authenticator.handle);
  return {
    id: b64(authenticator.credentialId),
    rawId: b64(authenticator.credentialId),
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(client),
      authenticatorData: b64(data),
      signature: b64(signature),
      ...(userHandle === undefined ? {} : { userHandle }),
    },
  };
}

function clientData(type: "webauthn.create" | "webauthn.get", shape: CeremonyShape): Buffer {
  const body: Record<string, unknown> = {
    type,
    challenge: shape.challenge,
    origin: shape.origin,
    crossOrigin: shape.crossOrigin ?? false,
  };
  if (shape.topOrigin !== undefined) body["topOrigin"] = shape.topOrigin;
  return Buffer.from(JSON.stringify(body), "utf8");
}

function authenticatorData(
  authenticator: SoftwareAuthenticator,
  shape: CeremonyShape,
  attested: boolean,
): Buffer {
  const rpIdHash = createHash("sha256").update(shape.rpId, "utf8").digest();
  let flags = 0;
  if (shape.userPresent ?? true) flags |= 0x01;
  if (shape.userVerified ?? true) flags |= 0x04;
  if (shape.backupEligible ?? true) flags |= 0x08;
  if (shape.backupState ?? true) flags |= 0x10;
  if (attested) flags |= 0x40;
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(shape.signCount ?? 0);
  const parts = [rpIdHash, Buffer.from([flags]), counter];
  if (attested) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(authenticator.credentialId.length);
    parts.push(
      authenticator.aaguid,
      length,
      authenticator.credentialId,
      authenticator.cosePublicKey,
    );
  }
  return Buffer.concat(parts);
}

function generateKey(algorithm: AuthenticatorAlgorithm): {
  publicKey: KeyObject;
  privateKey: KeyObject;
} {
  if (algorithm === "RS256") {
    return generateKeyPairSync("rsa", { modulusLength: 2048 });
  }
  if (algorithm === "EdDSA") return generateKeyPairSync("ed25519");
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

function cosePublicKey(algorithm: AuthenticatorAlgorithm, publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  if (algorithm === "RS256") {
    if (typeof jwk.n !== "string" || typeof jwk.e !== "string") {
      throw new Error("software authenticator did not export an RSA key");
    }
    return coseRs256(Buffer.from(jwk.n, "base64url"), Buffer.from(jwk.e, "base64url"));
  }
  if (algorithm === "EdDSA") {
    if (typeof jwk.x !== "string") {
      throw new Error("software authenticator did not export an Ed25519 key");
    }
    return coseEd25519(Buffer.from(jwk.x, "base64url"));
  }
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new Error("software authenticator did not export a P-256 key");
  }
  return coseEs256(Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url"));
}

function signAssertion(key: KeyObject, payload: Buffer): Buffer {
  if (key.asymmetricKeyType === "ed25519") return sign(null, payload, key);
  if (key.asymmetricKeyType === "rsa") {
    return sign("sha256", payload, { key, padding: constants.RSA_PKCS1_PADDING });
  }
  return sign("sha256", payload, { key, dsaEncoding: "der" });
}

/** COSE RSA key, canonical integer order: kty, alg, n, e. Algorithm -257. */
function coseRs256(modulus: Buffer, exponent: Buffer): Buffer {
  return Buffer.concat([
    header(5, 4),
    header(0, 1),
    header(0, 3),
    header(0, 3),
    negative(257),
    header(1, 0),
    bytes(modulus),
    header(1, 1),
    bytes(exponent),
  ]);
}

/** COSE OKP key, canonical integer order: kty, alg, crv, x. Algorithm -8, Ed25519. */
function coseEd25519(x: Buffer): Buffer {
  return Buffer.concat([
    header(5, 4),
    header(0, 1),
    header(0, 1),
    header(0, 3),
    header(1, 7),
    header(1, 0),
    header(0, 6),
    header(1, 1),
    bytes(x),
  ]);
}

/** COSE EC2 key, canonical integer order: kty, alg, crv, x, y. */
function coseEs256(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    header(5, 5),
    header(0, 1),
    header(0, 2),
    header(0, 3),
    header(1, 6),
    header(1, 0),
    header(0, 1),
    header(1, 1),
    bytes(x),
    header(1, 2),
    bytes(y),
  ]);
}

function negative(distance: number): Buffer {
  return header(1, distance - 1);
}

function header(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const encoded = Buffer.alloc(3);
  encoded[0] = (major << 5) | 25;
  encoded.writeUInt16BE(value, 1);
  return encoded;
}

function bytes(value: Buffer): Buffer {
  return Buffer.concat([header(2, value.length), value]);
}

function text(value: string): Buffer {
  return Buffer.concat([header(3, Buffer.byteLength(value)), Buffer.from(value, "utf8")]);
}

function b64(value: Buffer): string {
  return value.toString("base64url");
}
