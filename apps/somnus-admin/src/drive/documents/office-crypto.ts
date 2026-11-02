/**
 * A password on an exported Word file (owner decision 2026-11-02): the .docx is
 * wrapped the way Office itself does it, "agile" encryption from MS-OFFCRYPTO
 * (AES-256-CBC, SHA-512, 100 000 rounds), so Word, LibreOffice and Pages ask for
 * the password before opening it. Everything runs in this browser with
 * WebCrypto; the only library is the one that writes the container (cfb).
 */

import { sha512Sync } from "./sha512.js";

const SPIN_COUNT = 100_000;
const SEGMENT = 4096;

// MS-OFFCRYPTO 2.3.4.13: the constants that tell each derived key apart.
const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const BLOCK_HMAC_KEY = [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6];
const BLOCK_HMAC_VALUE = [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33];

type Bytes = Uint8Array<ArrayBuffer>;

function concat(...parts: ArrayLike<number>[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u32(value: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

async function sha512(...parts: ArrayLike<number>[]): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-512", concat(...parts)));
}

/** `bytes` cut or padded (with 0x36, as the specification says) to `length`. */
function fit(bytes: Bytes, length: number, pad = 0x36): Bytes {
  const out = new Uint8Array(length).fill(pad);
  out.set(bytes.subarray(0, length));
  return out;
}

/** AES-256-CBC with no padding of its own: input is zero-padded to whole blocks. */
async function aesCbc(rawKey: Bytes, iv: Bytes, data: Bytes): Promise<Bytes> {
  const padded = fit(data, Math.ceil(data.length / 16) * 16 || 16, 0);
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-CBC", false, ["encrypt"]);
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, padded));
  // WebCrypto always appends one PKCS#7 block; Office's format has none.
  return out.slice(0, padded.length);
}

function base64(bytes: Bytes): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function utf16(text: string): Bytes {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
}

/** UNICODE-LP-P4: a length-prefixed UTF-16 string, padded to 4 bytes. */
function lpUnicode(text: string): Bytes {
  const body = utf16(text);
  return concat(u32(body.length), body, new Uint8Array((4 - (body.length % 4)) % 4));
}

const version1 = () => concat([1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]);

/** The \x06DataSpaces storage that names the encryption transform (MS-OFFCRYPTO 2.1). */
function dataSpaces(): Array<[string, Bytes]> {
  const transformId = lpUnicode("{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}");
  const entry = concat(
    u32(1),
    u32(0),
    lpUnicode("EncryptedPackage"),
    lpUnicode("StrongEncryptionDataSpace"),
  );
  return [
    ["Version", concat(lpUnicode("Microsoft.Container.DataSpaces"), version1())],
    ["DataSpaceMap", concat(u32(8), u32(1), u32(entry.length + 4), entry)],
    [
      "DataSpaceInfo/StrongEncryptionDataSpace",
      concat(u32(8), u32(1), lpUnicode("StrongEncryptionTransform")),
    ],
    [
      "TransformInfo/StrongEncryptionTransform/\u0006Primary",
      concat(
        u32(8 + transformId.length),
        u32(1),
        transformId,
        lpUnicode("Microsoft.Container.EncryptionTransform"),
        version1(),
        u32(0),
        u32(0),
        u32(0),
        u32(4),
      ),
    ],
  ];
}

/** The .docx bytes, encrypted with `password`, as a file Word opens after asking for it. */
export async function encryptOfficeFile(plain: Uint8Array, password: string): Promise<Bytes> {
  const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  const keySalt = random(16);
  const passwordSalt = random(16);
  const secret = random(32);

  // The password key: SHA-512 of salt + password, then 100 000 more rounds.
  let hash: Uint8Array = await sha512(passwordSalt, utf16(password));
  const round = new Uint8Array(68);
  for (let i = 0; i < SPIN_COUNT; i++) {
    new DataView(round.buffer).setUint32(0, i, true);
    round.set(hash, 4);
    hash = sha512Sync(round);
  }
  const derived = async (block: number[]) => fit(await sha512(hash, block), 32);

  const verifierInput = random(16);
  const encryptedVerifierInput = await aesCbc(
    await derived(BLOCK_VERIFIER_INPUT),
    passwordSalt,
    verifierInput,
  );
  const encryptedVerifierValue = await aesCbc(
    await derived(BLOCK_VERIFIER_VALUE),
    passwordSalt,
    await sha512(verifierInput),
  );
  const encryptedKey = await aesCbc(await derived(BLOCK_KEY_VALUE), passwordSalt, secret);

  // The package: its size, then 4 KiB segments, each with an IV of its own.
  const segments: Bytes[] = [];
  for (let at = 0, index = 0; at < plain.length; at += SEGMENT, index++) {
    const iv = fit(await sha512(keySalt, u32(index)), 16);
    segments.push(await aesCbc(secret, iv, new Uint8Array(plain.subarray(at, at + SEGMENT))));
  }
  const size = new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0, BigInt(plain.length), true);
  const encryptedPackage = concat(size, ...segments);

  // Integrity: an HMAC-SHA512 of the whole encrypted package, itself encrypted.
  const hmacKey = random(64);
  const hmacKeyObject = await crypto.subtle.importKey(
    "raw",
    hmacKey,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKeyObject, encryptedPackage));
  const encryptedHmacKey = await aesCbc(
    secret,
    fit(await sha512(keySalt, BLOCK_HMAC_KEY), 16),
    hmacKey,
  );
  const encryptedHmacValue = await aesCbc(
    secret,
    fit(await sha512(keySalt, BLOCK_HMAC_VALUE), 16),
    hmac,
  );

  const params = (salt: Bytes) =>
    `saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${base64(salt)}"`;
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">' +
    `<keyData ${params(keySalt)}/>` +
    `<dataIntegrity encryptedHmacKey="${base64(encryptedHmacKey)}" encryptedHmacValue="${base64(encryptedHmacValue)}"/>` +
    '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
    `<p:encryptedKey spinCount="${SPIN_COUNT}" ${params(passwordSalt)} encryptedVerifierHashInput="${base64(encryptedVerifierInput)}" encryptedVerifierHashValue="${base64(encryptedVerifierValue)}" encryptedKeyValue="${base64(encryptedKey)}"/>` +
    "</keyEncryptor></keyEncryptors></encryption>";
  // Version 4.4, flags 0x40: agile encryption.
  const encryptionInfo = concat([4, 0, 4, 0], u32(0x40), new TextEncoder().encode(xml));

  const CFB = await import("cfb");
  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, "/EncryptionInfo", encryptionInfo);
  CFB.utils.cfb_add(container, "/EncryptedPackage", encryptedPackage);
  for (const [path, bytes] of dataSpaces()) {
    CFB.utils.cfb_add(container, `/\u0006DataSpaces/${path}`, bytes);
  }
  const written = CFB.write(container, { type: "array" }) as ArrayLike<number>;
  return Uint8Array.from(written);
}
