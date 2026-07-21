import { validate as isValidUuid, v7 as uuidv7 } from "uuid";
import { z } from "zod";

/**
 * Opaque, time-ordered, URL-safe identifier.
 *
 * Per build plan §12, every identifier exposed across services is an
 * opaque UUIDv7. Sequential database identifiers are never exposed.
 */
export type UUIDv7 = string;

export const UUIDv7Schema = z
  .string()
  .uuid()
  .refine((s) => isValidUuid(s) && extractVersion(s) === 7, {
    message: "must be a UUIDv7",
  });

export const opaqueIdSchema = UUIDv7Schema;

export function UUIDv7(): UUIDv7 {
  return uuidv7();
}

export const opaqueId = UUIDv7;

export function isUUIDv7(value: unknown): value is UUIDv7 {
  return typeof value === "string" && UUIDv7Schema.safeParse(value).success;
}

export function parseOpaqueId(value: unknown): UUIDv7 {
  const parsed = UUIDv7Schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid opaque id: expected UUIDv7, got ${typeof value === "string" ? value : typeof value}`,
    );
  }
  return parsed.data;
}

function extractVersion(s: string): number | null {
  // UUID format: xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-)([0-9a-f])([0-9a-f]{3}-)/i.exec(s);
  if (!m) return null;
  return Number.parseInt(m[2] ?? "", 16);
}
