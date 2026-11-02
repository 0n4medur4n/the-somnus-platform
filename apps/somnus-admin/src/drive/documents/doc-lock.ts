import type { JSONContent } from "@tiptap/core";

/**
 * A document's own password (owner decision 2026-11-02), on top of the Drive's
 * encryption: the document's text is sealed with a key derived from the
 * password, in this browser, before the Drive encrypts the file as usual. The
 * password is never stored or sent; forgetting it loses the text for everyone.
 * The file's name, its notes and its colour are not covered by it.
 */
export const LOCK_ITERATIONS = 600_000;
export const PASSWORD_MIN_LENGTH = 8;

export type LockedBody = {
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
};

/** The key a document was opened or locked with, kept in memory to save it again. */
export type DocLock = { key: CryptoKey; salt: Uint8Array<ArrayBuffer>; iterations: number };

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong document password");
    this.name = "WrongPasswordError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A new lock for `password`, with a fresh salt. */
export async function newLock(password: string): Promise<DocLock> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    key: await deriveKey(password, salt, LOCK_ITERATIONS),
    salt,
    iterations: LOCK_ITERATIONS,
  };
}

/**
 * What is sealed: the text, or the text with its header, footer and page
 * numbering (all of it is behind the password).
 */
export type SealedPage =
  | JSONContent
  | {
      content: JSONContent;
      header?: JSONContent | undefined;
      footer?: JSONContent | undefined;
      pageNumbers?: boolean | undefined;
    };

export async function seal(content: SealedPage, lock: DocLock): Promise<LockedBody> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    lock.key,
    new TextEncoder().encode(JSON.stringify(content)),
  );
  return {
    kdf: "PBKDF2-SHA256",
    iterations: lock.iterations,
    salt: toBase64(lock.salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

/** The document's text and the lock to save it with, or WrongPasswordError. */
export async function unseal(
  body: LockedBody,
  password: string,
): Promise<{ content: JSONContent; lock: DocLock; extras: Record<string, unknown> }> {
  const salt = fromBase64(body.salt);
  const key = await deriveKey(password, salt, body.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(body.iv) },
      key,
      fromBase64(body.data),
    );
  } catch {
    throw new WrongPasswordError();
  }
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as
    | JSONContent
    | { content?: JSONContent; [extra: string]: unknown };
  const lockOut = { key, salt, iterations: body.iterations };
  // A document sealed before headers existed is its text alone.
  if ((parsed as JSONContent)?.type === "doc") {
    return { content: parsed as JSONContent, lock: lockOut, extras: {} };
  }
  const { content, ...extras } = parsed as { content?: JSONContent; [extra: string]: unknown };
  if (content?.type !== "doc") throw new WrongPasswordError();
  return { content, lock: lockOut, extras };
}

/** A sealed body as stored, or null when `value` is not one. */
export function lockedBodyOf(value: unknown): LockedBody | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Partial<LockedBody>;
  const iterations = body.iterations;
  return body.kdf === "PBKDF2-SHA256" &&
    typeof iterations === "number" &&
    Number.isInteger(iterations) &&
    iterations >= 100_000 &&
    iterations <= 10_000_000 &&
    typeof body.salt === "string" &&
    typeof body.iv === "string" &&
    typeof body.data === "string"
    ? {
        kdf: "PBKDF2-SHA256",
        iterations,
        salt: body.salt,
        iv: body.iv,
        data: body.data,
      }
    : null;
}
