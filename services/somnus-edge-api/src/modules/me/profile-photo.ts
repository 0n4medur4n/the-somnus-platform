/**
 * Profile photo checks. The app re-encodes every photo in the browser (resized,
 * WebP or JPEG), which drops the metadata a phone camera writes -- EXIF can
 * carry the GPS position where the picture was taken. This module does not
 * trust that: it reads the file's own structure, accepts only a real WebP or
 * JPEG, and refuses one that still carries EXIF or XMP. Anything else is
 * rejected, so what is stored can never be served as something other than an
 * image.
 */

/** 1 MB. A 512 px photo re-encoded by the app is a few tens of KB. */
export const PROFILE_PHOTO_MAX_BYTES = 1024 * 1024;

export const PROFILE_PHOTO_TYPES = ["image/webp", "image/jpeg"] as const;
export type ProfilePhotoType = (typeof PROFILE_PHOTO_TYPES)[number];

export type PhotoRejection = "too_large" | "not_an_image" | "type_mismatch" | "unsafe_structure";

export type PhotoInspection =
  | { ok: true; type: ProfilePhotoType }
  | { ok: false; reason: PhotoRejection };

export function isProfilePhotoType(value: string): value is ProfilePhotoType {
  return (PROFILE_PHOTO_TYPES as ReadonlyArray<string>).includes(value);
}

/** The content type the bytes really are, or null. Never the declared one. */
function sniff(bytes: Buffer): ProfilePhotoType | null {
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** WebP chunks the app's encoder produces, plus a colour profile. Nothing else. */
const WEBP_ALLOWED_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP"]);

/** Walks the RIFF chunks; false if any is truncated or not on the allowlist (EXIF, XMP, animation). */
function webpIsClean(bytes: Buffer): boolean {
  const riffEnd = 8 + bytes.readUInt32LE(4);
  if (riffEnd > bytes.length) return false;
  let offset = 12;
  let sawImage = false;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) return false;
    const fourcc = bytes.toString("latin1", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (!WEBP_ALLOWED_CHUNKS.has(fourcc)) return false;
    if (fourcc === "VP8 " || fourcc === "VP8L") sawImage = true;
    offset += 8 + size + (size % 2);
  }
  return sawImage && offset === riffEnd;
}

/** APP1 is where JPEG keeps EXIF and XMP. */
const JPEG_APP1 = 0xe1;
const JPEG_SOS = 0xda;

/** Walks the JPEG segments up to the image data; false on APP1 or a broken structure. */
function jpegIsClean(bytes: Buffer): boolean {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1] as number;
    if (marker === JPEG_SOS) return true;
    if (marker === JPEG_APP1) return false;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return false;
    offset += 2 + length;
  }
  return false;
}

export function inspectProfilePhoto(bytes: Buffer, declaredType: string): PhotoInspection {
  if (bytes.length > PROFILE_PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
  const actual = sniff(bytes);
  if (actual === null) return { ok: false, reason: "not_an_image" };
  if (actual !== declaredType) return { ok: false, reason: "type_mismatch" };
  const clean = actual === "image/webp" ? webpIsClean(bytes) : jpegIsClean(bytes);
  return clean ? { ok: true, type: actual } : { ok: false, reason: "unsafe_structure" };
}
