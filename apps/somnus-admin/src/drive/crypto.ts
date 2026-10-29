import {
  DRIVE_PBKDF2_MIN_ITERATIONS,
  type DriveAccount,
  type DriveEnrollRequest,
  type DriveMemberKey,
  type DriveMemberKeyInput,
  type DriveMetaSealed,
  type DriveNodeKeyInput,
  type DrivePassphraseWrap,
  type DriveRecoveryWrap,
  type DriveRewrapRequest,
  type DriveSealed,
  type DriveStateSealed,
} from "@somnus/api-contracts";
import { cleanAppearance, type DriveColor } from "./appearance.js";

/**
 * The staff Drive's cryptography (ADR 0019). Everything here runs in the
 * browser, on WebCrypto, with no third-party code: the server receives what
 * these functions return and nothing else.
 *
 * The key hierarchy, top to bottom:
 *
 *   passphrase --PBKDF2--> KEK ┐
 *   recovery code --HKDF--> KEK ┴─ wrap ─> account key (AES-256)
 *   account key ─ seals ─> private keys (ECDH P-256 for receiving, ECDSA P-256 for signing)
 *   folder key (AES-256, one per shared folder, per key generation)
 *     ─ wrapped per member via ECDH(ephemeral, member) + HKDF, and signed by the granter
 *   node key (AES-256, one per folder or file) ─ wrapped under the folder key
 *   node key ─ seals ─> the node's name/type/size, and every block of its content
 *
 * Every AES-GCM seal carries associated data naming exactly where the box
 * belongs (folder, node, revision, block index and count). A server that moves a
 * box somewhere else -- swaps two files' blocks, replays a block at another
 * index, truncates a file -- produces a box that no longer opens.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

/** Why something in the Drive could not be opened. The UI translates these. */
export type DriveCryptoFailure = "wrong_secret" | "tampered" | "bad_signature" | "unknown_signer";

export class DriveCryptoError extends Error {
  constructor(readonly failure: DriveCryptoFailure) {
    super(`drive crypto: ${failure}`);
    this.name = "DriveCryptoError";
  }
}

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export const DRIVE_PBKDF2_ITERATIONS = DRIVE_PBKDF2_MIN_ITERATIONS;

// --- encodings ---

export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function toB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromB64(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length);
  // getRandomValues refuses more than 64 KiB per call.
  for (let offset = 0; offset < length; offset += 65_536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  }
  return bytes;
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Overwrites key material we held as bytes. Best effort: JS cannot promise more. */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

export async function sha256(bytes: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle().digest("SHA-256", bytes as Bytes));
}

// --- the recovery code: 160 random bits, Crockford base32, grouped for reading aloud ---

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_BYTES = 20;

export function encodeRecoveryCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * Accepts the code however a person typed it back: any case, with or without
 * dashes or spaces, and the letters people confuse with digits.
 */
export function decodeRecoveryCode(code: string): Bytes | null {
  const cleaned = code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (cleaned.length !== 32) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = CROCKFORD.indexOf(char);
    if (index < 0) return null;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length === RECOVERY_BYTES ? new Uint8Array(out) : null;
}

// --- AES-GCM ---

async function aesKey(raw: Bytes): Promise<CryptoKey> {
  return subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: string,
): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: utf8(aad) },
    key,
    plaintext as Bytes,
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function unseal(
  key: CryptoKey,
  sealed: { iv: string; ct: string },
  aad: string,
  failure: DriveCryptoFailure = "tampered",
): Promise<Bytes> {
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: utf8(aad) },
      key,
      fromB64(sealed.ct),
    );
    return new Uint8Array(plain);
  } catch {
    throw new DriveCryptoError(failure);
  }
}

// --- key derivation ---

async function passphraseKek(passphrase: string, salt: Bytes, iterations: number) {
  const base = await subtle().importKey(
    "raw",
    utf8(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function hkdfKey(secret: Bytes, salt: Bytes, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: utf8(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const AAD = {
  privateKeys: "somnus-drive/private-keys/v1",
  passphrase: "somnus-drive/account-key/passphrase/v1",
  recovery: "somnus-drive/account-key/recovery/v1",
  state: (userId: string) => `somnus-drive/state/v1|${userId}`,
  memberKey: (shareId: string, userId: string, generation: number) =>
    `somnus-drive/member-key/v1|${shareId}|${userId}|${generation}`,
  nodeKey: (shareId: string, nodeId: string, generation: number) =>
    `somnus-drive/node-key/v1|${shareId}|${nodeId}|${generation}`,
  meta: (shareId: string, nodeId: string, revision: number) =>
    `somnus-drive/meta/v1|${shareId}|${nodeId}|${revision}`,
  block: (nodeId: string, revision: number, index: number, count: number) =>
    `somnus-drive/block/v1|${nodeId}|${revision}|${index}|${count}`,
};

async function wrapWithPassphrase(
  accountKey: Bytes,
  passphrase: string,
  iterations: number,
): Promise<DrivePassphraseWrap> {
  const salt = randomBytes(16);
  const kek = await passphraseKek(passphrase, salt, iterations);
  const sealed = await seal(kek, accountKey, AAD.passphrase);
  return { kdf: "PBKDF2-SHA256", iterations, salt: toB64(salt), ...sealed };
}

async function wrapWithRecovery(
  accountKey: Bytes,
): Promise<{ wrap: DriveRecoveryWrap; code: string }> {
  const secret = randomBytes(RECOVERY_BYTES);
  const salt = randomBytes(16);
  const kek = await hkdfKey(secret, salt, AAD.recovery);
  const sealed = await seal(kek, accountKey, AAD.recovery);
  const code = encodeRecoveryCode(secret);
  wipe(secret);
  return { wrap: { kdf: "HKDF-SHA256", salt: toB64(salt), ...sealed }, code };
}

// --- the account ---

/** An unlocked Drive identity. Lives in memory only, and only while the Drive is open. */
export type UnlockedAccount = {
  userId: string;
  keyVersion: number;
  encPrivate: CryptoKey;
  signPrivate: CryptoKey;
  encPublicKey: string;
  signPublicKey: string;
  fingerprint: string;
  /** Seals the person's own state (verified colleague keys). Non-extractable. */
  stateKey: CryptoKey;
};

/**
 * A key's human-checkable fingerprint: SHA-256 over both public keys, the first
 * 20 bytes in ten groups of four hex digits. Two colleagues who read the same
 * groups to each other know the server has not swapped a key between them.
 */
export async function fingerprintOf(encPublicKey: string, signPublicKey: string): Promise<string> {
  const digest = await sha256(concat(fromB64(encPublicKey), fromB64(signPublicKey)));
  const hex = Array.from(digest.subarray(0, 20), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return (hex.match(/.{4}/g) ?? []).join(" ");
}

async function unlockWithAccountKey(
  account: Pick<
    DriveAccount,
    "userId" | "keyVersion" | "privateKeys" | "encPublicKey" | "signPublicKey"
  >,
  accountKeyRaw: Bytes,
): Promise<UnlockedAccount> {
  const accountKey = await aesKey(accountKeyRaw);
  const keys = JSON.parse(
    fromUtf8(await unseal(accountKey, account.privateKeys, AAD.privateKeys)),
  ) as { enc: string; sign: string };
  const encPkcs8 = fromB64(keys.enc);
  const signPkcs8 = fromB64(keys.sign);
  const [encPrivate, signPrivate] = await Promise.all([
    subtle().importKey("pkcs8", encPkcs8, ECDH, false, ["deriveBits"]),
    subtle().importKey("pkcs8", signPkcs8, ECDSA, false, ["sign"]),
  ]);
  wipe(encPkcs8);
  wipe(signPkcs8);
  return {
    userId: account.userId,
    keyVersion: account.keyVersion,
    encPrivate,
    signPrivate,
    encPublicKey: account.encPublicKey,
    signPublicKey: account.signPublicKey,
    fingerprint: await fingerprintOf(account.encPublicKey, account.signPublicKey),
    stateKey: accountKey,
  };
}

export type NewAccount = {
  request: DriveEnrollRequest;
  /** Shown once, never sent anywhere. */
  recoveryCode: string;
  /** Opens the account the server returns, without paying for PBKDF2 a second time. */
  unlock: (account: DriveAccount) => Promise<UnlockedAccount>;
};

/** Generates a Drive identity. Nothing secret leaves this function except inside sealed boxes. */
export async function createAccount(
  passphrase: string,
  iterations = DRIVE_PBKDF2_ITERATIONS,
): Promise<NewAccount> {
  const [enc, sign] = await Promise.all([
    subtle().generateKey(ECDH, true, ["deriveBits"]),
    subtle().generateKey(ECDSA, true, ["sign", "verify"]),
  ]);
  const [encSpki, signSpki, encPkcs8, signPkcs8] = await Promise.all([
    subtle().exportKey("spki", enc.publicKey),
    subtle().exportKey("spki", sign.publicKey),
    subtle().exportKey("pkcs8", enc.privateKey),
    subtle().exportKey("pkcs8", sign.privateKey),
  ]);
  const accountKeyRaw = randomBytes(32);
  const accountKey = await aesKey(accountKeyRaw);
  const privateBundle = utf8(
    JSON.stringify({
      enc: toB64(new Uint8Array(encPkcs8)),
      sign: toB64(new Uint8Array(signPkcs8)),
    }),
  );
  const privateKeys: DriveSealed = await seal(accountKey, privateBundle, AAD.privateKeys);
  wipe(privateBundle);

  const passphraseWrap = await wrapWithPassphrase(accountKeyRaw, passphrase, iterations);
  const recovery = await wrapWithRecovery(accountKeyRaw);

  return {
    request: {
      encPublicKey: toB64(new Uint8Array(encSpki)),
      signPublicKey: toB64(new Uint8Array(signSpki)),
      privateKeys,
      passphraseWrap,
      recoveryWrap: recovery.wrap,
    },
    recoveryCode: recovery.code,
    unlock: async (account) => {
      try {
        return await unlockWithAccountKey(account, accountKeyRaw);
      } finally {
        wipe(accountKeyRaw);
      }
    },
  };
}

export async function unlockWithPassphrase(
  account: DriveAccount,
  passphrase: string,
): Promise<UnlockedAccount> {
  const wrap = account.passphraseWrap;
  const kek = await passphraseKek(passphrase, fromB64(wrap.salt), wrap.iterations);
  const accountKeyRaw = await unseal(kek, wrap, AAD.passphrase, "wrong_secret");
  try {
    return await unlockWithAccountKey(account, accountKeyRaw);
  } finally {
    wipe(accountKeyRaw);
  }
}

async function accountKeyFromRecovery(account: DriveAccount, code: string): Promise<Bytes> {
  const secret = decodeRecoveryCode(code);
  if (!secret) throw new DriveCryptoError("wrong_secret");
  const wrap = account.recoveryWrap;
  const kek = await hkdfKey(secret, fromB64(wrap.salt), AAD.recovery);
  wipe(secret);
  return unseal(kek, wrap, AAD.recovery, "wrong_secret");
}

/**
 * The recovery path: the code opens the account, a new passphrase is set, and a
 * NEW recovery code replaces the used one -- a code that has been typed into a
 * screen is a code that may have been seen.
 */
export async function recoverAccount(
  account: DriveAccount,
  code: string,
  newPassphrase: string,
  iterations = DRIVE_PBKDF2_ITERATIONS,
): Promise<{ unlocked: UnlockedAccount; rewrap: DriveRewrapRequest; recoveryCode: string }> {
  const accountKeyRaw = await accountKeyFromRecovery(account, code);
  try {
    const passphraseWrap = await wrapWithPassphrase(accountKeyRaw, newPassphrase, iterations);
    const recovery = await wrapWithRecovery(accountKeyRaw);
    const unlocked = await unlockWithAccountKey(account, accountKeyRaw);
    return {
      unlocked,
      rewrap: { passphraseWrap, recoveryWrap: recovery.wrap },
      recoveryCode: recovery.code,
    };
  } finally {
    wipe(accountKeyRaw);
  }
}

/** A new passphrase, proven by the current one. The keys themselves do not change. */
export async function changePassphrase(
  account: DriveAccount,
  current: string,
  next: string,
  iterations = DRIVE_PBKDF2_ITERATIONS,
): Promise<DrivePassphraseWrap> {
  const wrap = account.passphraseWrap;
  const kek = await passphraseKek(current, fromB64(wrap.salt), wrap.iterations);
  const accountKeyRaw = await unseal(kek, wrap, AAD.passphrase, "wrong_secret");
  try {
    return await wrapWithPassphrase(accountKeyRaw, next, iterations);
  } finally {
    wipe(accountKeyRaw);
  }
}

// --- per-person state: the colleague keys this person has seen and verified ---

/**
 * Trust on first use, made visible. The first time a colleague's key is seen it
 * is remembered (`verified: false`); comparing fingerprints in person or by
 * phone marks it `verified: true`. A key that later differs from the
 * remembered one is flagged as changed, never silently accepted.
 */
export type DriveContact = { fingerprint: string; verified: boolean };
export type DriveState = { contacts: Record<string, DriveContact> };

export async function sealState(me: UnlockedAccount, state: DriveState): Promise<DriveStateSealed> {
  return seal(me.stateKey, utf8(JSON.stringify(state)), AAD.state(me.userId));
}

export async function openState(
  me: UnlockedAccount,
  sealed: DriveStateSealed | null,
): Promise<DriveState> {
  if (!sealed) return { contacts: {} };
  const parsed = JSON.parse(fromUtf8(await unseal(me.stateKey, sealed, AAD.state(me.userId))));
  return { contacts: { ...(parsed as Partial<DriveState>).contacts } };
}

// --- signatures ---

async function sign(me: UnlockedAccount, payload: string): Promise<string> {
  const signature = await subtle().sign(ECDSA_SIGN, me.signPrivate, utf8(payload));
  return toB64(new Uint8Array(signature));
}

async function verify(signPublicKey: string, payload: string, signature: string): Promise<boolean> {
  try {
    const key = await subtle().importKey("spki", fromB64(signPublicKey), ECDSA, false, ["verify"]);
    return await subtle().verify(ECDSA_SIGN, key, fromB64(signature), utf8(payload));
  } catch {
    return false;
  }
}

async function memberKeyPayload(input: {
  shareId: string;
  userId: string;
  keyGeneration: number;
  ephemeralPublicKey: string;
  iv: string;
  ct: string;
}): Promise<string> {
  const digest = await sha256(
    concat(fromB64(input.ephemeralPublicKey), fromB64(input.iv), fromB64(input.ct)),
  );
  return JSON.stringify([
    "somnus-drive/member-key/v1",
    input.shareId,
    input.userId,
    input.keyGeneration,
    toB64(digest),
  ]);
}

export async function metaHash(meta: DriveMetaSealed): Promise<string> {
  return toB64(await sha256(concat(fromB64(meta.iv), fromB64(meta.ct))));
}

function nodePayload(input: {
  shareId: string;
  nodeId: string;
  kind: "folder" | "file";
  revision: number;
  metaHash: string;
  contentHash: string;
}): string {
  return JSON.stringify([
    "somnus-drive/node/v1",
    input.shareId,
    input.nodeId,
    input.kind,
    input.revision,
    input.metaHash,
    input.contentHash,
  ]);
}

export async function signNode(
  me: UnlockedAccount,
  input: Parameters<typeof nodePayload>[0],
): Promise<string> {
  return sign(me, nodePayload(input));
}

export async function verifyNode(
  signPublicKey: string,
  input: Parameters<typeof nodePayload>[0],
  signature: string,
): Promise<boolean> {
  return verify(signPublicKey, nodePayload(input), signature);
}

// --- folder keys, wrapped per member ---

async function memberWrapKey(shared: Bytes, info: string): Promise<CryptoKey> {
  return hkdfKey(shared, new Uint8Array(32), info);
}

/**
 * Wraps a folder key for one colleague: a fresh ephemeral ECDH key agrees a
 * secret with their public key, HKDF turns it into a one-off AES key, and the
 * folder key is sealed under it. Signed by `me`, so the colleague can tell it
 * came from a person they know and not from the server.
 */
export async function wrapShareKeyFor(input: {
  me: UnlockedAccount;
  shareId: string;
  recipientUserId: string;
  recipientEncPublicKey: string;
  keyGeneration: number;
  shareKey: Bytes;
}): Promise<DriveMemberKeyInput> {
  const recipient = await subtle().importKey(
    "spki",
    fromB64(input.recipientEncPublicKey),
    ECDH,
    false,
    [],
  );
  const ephemeral = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: "ECDH", public: recipient }, ephemeral.privateKey, 256),
  );
  const context = AAD.memberKey(input.shareId, input.recipientUserId, input.keyGeneration);
  const wrapKey = await memberWrapKey(shared, context);
  wipe(shared);
  const sealed = await seal(wrapKey, input.shareKey, context);
  const ephemeralPublicKey = toB64(
    new Uint8Array(await subtle().exportKey("spki", ephemeral.publicKey)),
  );
  const signature = await sign(
    input.me,
    await memberKeyPayload({
      shareId: input.shareId,
      userId: input.recipientUserId,
      keyGeneration: input.keyGeneration,
      ephemeralPublicKey,
      ...sealed,
    }),
  );
  return { ephemeralPublicKey, ...sealed, signature };
}

/**
 * Opens my copy of a folder key -- after checking that a colleague I can
 * identify signed it. `signerPublicKey` is null when the signer is not in the
 * directory, and then nothing is opened.
 */
export async function unwrapShareKey(input: {
  me: UnlockedAccount;
  shareId: string;
  memberKey: DriveMemberKey;
  signerPublicKey: string | null;
}): Promise<Bytes> {
  if (!input.signerPublicKey) throw new DriveCryptoError("unknown_signer");
  const { memberKey } = input;
  const payload = await memberKeyPayload({
    shareId: input.shareId,
    userId: input.me.userId,
    keyGeneration: memberKey.keyGeneration,
    ephemeralPublicKey: memberKey.ephemeralPublicKey,
    iv: memberKey.iv,
    ct: memberKey.ct,
  });
  if (!(await verify(input.signerPublicKey, payload, memberKey.signature))) {
    throw new DriveCryptoError("bad_signature");
  }
  const ephemeral = await subtle().importKey(
    "spki",
    fromB64(memberKey.ephemeralPublicKey),
    ECDH,
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: "ECDH", public: ephemeral }, input.me.encPrivate, 256),
  );
  const context = AAD.memberKey(input.shareId, input.me.userId, memberKey.keyGeneration);
  const wrapKey = await memberWrapKey(shared, context);
  wipe(shared);
  return unseal(wrapKey, memberKey, context);
}

// --- node keys, names and content ---

/** A folder key or node key held for use: its bytes (to rewrap) and its CryptoKey (to seal). */
export type SymmetricKey = { raw: Bytes; key: CryptoKey };

export async function newSymmetricKey(): Promise<SymmetricKey> {
  const raw = randomBytes(32);
  return { raw, key: await aesKey(raw) };
}

export async function importSymmetricKey(raw: Bytes): Promise<SymmetricKey> {
  return { raw, key: await aesKey(raw) };
}

export async function wrapNodeKey(input: {
  shareKey: SymmetricKey;
  shareId: string;
  nodeId: string;
  keyGeneration: number;
  nodeKey: Bytes;
}): Promise<DriveNodeKeyInput> {
  return seal(
    input.shareKey.key,
    input.nodeKey,
    AAD.nodeKey(input.shareId, input.nodeId, input.keyGeneration),
  );
}

export async function unwrapNodeKey(input: {
  shareKey: SymmetricKey;
  shareId: string;
  nodeId: string;
  keyGeneration: number;
  wrapped: DriveNodeKeyInput;
}): Promise<SymmetricKey> {
  const raw = await unseal(
    input.shareKey.key,
    input.wrapped,
    AAD.nodeKey(input.shareId, input.nodeId, input.keyGeneration),
  );
  return importSymmetricKey(raw);
}

/** What a node's sealed metadata holds. The server sees none of it. */
export type NodeMeta = {
  name: string;
  /** Files only. */
  mime?: string;
  /** Plaintext size in bytes, files only. */
  size?: number;
  /** A note written in the console (usage instructions, protocols) rather than an uploaded file. */
  note?: boolean;
  /** How it looks in the Drive (owner decision 2026-10-29): see `appearance.ts`. */
  color?: DriveColor;
  emoji?: string;
  modifiedAt: string;
};

export async function sealMeta(input: {
  nodeKey: SymmetricKey;
  shareId: string;
  nodeId: string;
  revision: number;
  meta: NodeMeta;
}): Promise<DriveMetaSealed> {
  return seal(
    input.nodeKey.key,
    utf8(JSON.stringify(input.meta)),
    AAD.meta(input.shareId, input.nodeId, input.revision),
  );
}

export async function openMeta(input: {
  nodeKey: SymmetricKey;
  shareId: string;
  nodeId: string;
  revision: number;
  sealed: DriveMetaSealed;
}): Promise<NodeMeta> {
  const plain = await unseal(
    input.nodeKey.key,
    input.sealed,
    AAD.meta(input.shareId, input.nodeId, input.revision),
  );
  const parsed = JSON.parse(fromUtf8(plain)) as Partial<NodeMeta>;
  if (typeof parsed.name !== "string" || typeof parsed.modifiedAt !== "string") {
    throw new DriveCryptoError("tampered");
  }
  // Signed by a member, but still only displayed if it is one of ours.
  const { color: _color, emoji: _emoji, ...rest } = parsed;
  return { ...(rest as NodeMeta), ...cleanAppearance(parsed) };
}

/** One block: a fresh 12-byte IV, then the AES-GCM ciphertext and tag. */
export async function encryptBlock(input: {
  nodeKey: SymmetricKey;
  nodeId: string;
  revision: number;
  index: number;
  count: number;
  plaintext: Uint8Array;
}): Promise<Bytes> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: utf8(AAD.block(input.nodeId, input.revision, input.index, input.count)),
    },
    input.nodeKey.key,
    input.plaintext as Bytes,
  );
  return concat(iv, new Uint8Array(ct));
}

export async function decryptBlock(input: {
  nodeKey: SymmetricKey;
  nodeId: string;
  revision: number;
  index: number;
  count: number;
  block: Uint8Array;
}): Promise<Bytes> {
  try {
    const plain = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: input.block.slice(0, 12) as Bytes,
        additionalData: utf8(AAD.block(input.nodeId, input.revision, input.index, input.count)),
      },
      input.nodeKey.key,
      input.block.slice(12) as Bytes,
    );
    return new Uint8Array(plain);
  } catch {
    throw new DriveCryptoError("tampered");
  }
}

/** SHA-256 over the per-block SHA-256s: what a file's signature commits to. */
export async function contentHash(blocks: ReadonlyArray<Uint8Array>): Promise<string> {
  const digests = await Promise.all(blocks.map((b) => sha256(b)));
  return toB64(await sha256(concat(...digests)));
}
