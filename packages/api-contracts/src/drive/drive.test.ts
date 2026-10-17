import { describe, expect, it } from "vitest";
import { UUIDv7 } from "../uuid.js";
import {
  base64Bytes,
  DRIVE_BLOCK_MAX_BYTES,
  DRIVE_MAX_BLOCKS,
  DRIVE_PBKDF2_MIN_ITERATIONS,
  DriveBlockSchema,
  DriveEnrollRequestSchema,
  DriveMemberRemoveRequestSchema,
  DriveShareCreateRequestSchema,
  DriveUploadStartRequestSchema,
} from "./drive.js";

/** `n` bytes of base64, the way the browser encodes ciphertext. */
function b64(n: number): string {
  return Buffer.alloc(n, 7).toString("base64");
}

const enroll = {
  encPublicKey: b64(91),
  signPublicKey: b64(91),
  privateKeys: { iv: b64(12), ct: b64(400) },
  passphraseWrap: {
    kdf: "PBKDF2-SHA256",
    iterations: DRIVE_PBKDF2_MIN_ITERATIONS,
    salt: b64(16),
    iv: b64(12),
    ct: b64(48),
  },
  recoveryWrap: { kdf: "HKDF-SHA256", salt: b64(16), iv: b64(12), ct: b64(48) },
};

describe("base64Bytes", () => {
  it("bounds the DECODED length, not the string length", () => {
    const schema = base64Bytes(12, 12);
    expect(schema.safeParse(b64(12)).success).toBe(true);
    expect(schema.safeParse(b64(11)).success).toBe(false);
    expect(schema.safeParse(b64(13)).success).toBe(false);
  });

  it("refuses anything that is not padded base64", () => {
    const schema = base64Bytes(1, 64);
    expect(schema.safeParse("not base64!").success).toBe(false);
    expect(schema.safeParse("abc").success).toBe(false);
    expect(schema.safeParse("<script>").success).toBe(false);
  });
});

describe("enrollment carries only public keys and sealed material", () => {
  it("accepts a well-formed enrollment", () => {
    expect(DriveEnrollRequestSchema.safeParse(enroll).success).toBe(true);
  });

  it("refuses a passphrase KDF weaker than the floor", () => {
    const weak = {
      ...enroll,
      passphraseWrap: { ...enroll.passphraseWrap, iterations: DRIVE_PBKDF2_MIN_ITERATIONS - 1 },
    };
    expect(DriveEnrollRequestSchema.safeParse(weak).success).toBe(false);
  });

  it("has no field a passphrase or recovery code could travel in", () => {
    const leaky = { ...enroll, passphrase: "correct horse battery staple" };
    expect(DriveEnrollRequestSchema.safeParse(leaky).success).toBe(false);
    const leakyWrap = {
      ...enroll,
      recoveryWrap: { ...enroll.recoveryWrap, code: "ABCD-EFGH" },
    };
    expect(DriveEnrollRequestSchema.safeParse(leakyWrap).success).toBe(false);
  });
});

describe("folders and files", () => {
  it("a share is created with its root and the owner's wrapped key", () => {
    const parsed = DriveShareCreateRequestSchema.safeParse({
      shareId: UUIDv7(),
      root: {
        nodeId: UUIDv7(),
        nodeKey: { iv: b64(12), ct: b64(48) },
        meta: { iv: b64(12), ct: b64(80) },
        signature: b64(64),
      },
      ownerKey: { ephemeralPublicKey: b64(91), iv: b64(12), ct: b64(48), signature: b64(64) },
    });
    expect(parsed.success).toBe(true);
  });

  it("caps a file at DRIVE_MAX_BLOCKS blocks", () => {
    const base = {
      nodeId: UUIDv7(),
      revision: 1,
      blockCount: DRIVE_MAX_BLOCKS,
      sizeBytes: 1024,
      contentHash: b64(32),
      meta: { iv: b64(12), ct: b64(80) },
      signature: b64(64),
    };
    expect(DriveUploadStartRequestSchema.safeParse(base).success).toBe(true);
    expect(
      DriveUploadStartRequestSchema.safeParse({ ...base, blockCount: DRIVE_MAX_BLOCKS + 1 })
        .success,
    ).toBe(false);
  });

  it("caps a block at DRIVE_BLOCK_MAX_BYTES", () => {
    expect(DriveBlockSchema.safeParse({ data: b64(DRIVE_BLOCK_MAX_BYTES) }).success).toBe(true);
    expect(DriveBlockSchema.safeParse({ data: b64(DRIVE_BLOCK_MAX_BYTES + 1) }).success).toBe(
      false,
    );
  });

  it("a removal is always a rotation: generation 1 cannot be the new key", () => {
    expect(
      DriveMemberRemoveRequestSchema.safeParse({ keyGeneration: 1, memberKeys: [], nodeKeys: [] })
        .success,
    ).toBe(false);
    expect(
      DriveMemberRemoveRequestSchema.safeParse({ keyGeneration: 2, memberKeys: [], nodeKeys: [] })
        .success,
    ).toBe(true);
  });
});
