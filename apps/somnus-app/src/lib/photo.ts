/**
 * Prepares a profile photo before it leaves the device: centre-cropped to a
 * square, scaled to 512 px, and re-encoded. Re-encoding through a canvas keeps
 * only the pixels, so the metadata a phone camera writes -- including the GPS
 * position where the picture was taken -- never leaves the browser. edge-api
 * checks the result again and refuses any file that still carries it.
 */

export const PHOTO_SIZE_PX = 512;
/** What the person may pick. The upload itself is a few tens of KB. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export type PhotoPrepError = "not_an_image" | "too_large" | "unreadable";

export class PhotoPrepFailure extends Error {
  constructor(readonly reason: PhotoPrepError) {
    super(reason);
    this.name = "PhotoPrepFailure";
  }
}

/** The centred square to cut from a `width` x `height` image. */
export function centreSquare(
  width: number,
  height: number,
): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}

/**
 * WebP where the browser can encode it; JPEG otherwise (Safari's canvas does
 * not encode WebP and silently returns PNG, which edge-api would refuse).
 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") return withoutMetadata(webp);
  const jpeg = await toBlob(canvas, "image/jpeg");
  if (jpeg?.type === "image/jpeg") return withoutMetadata(jpeg);
  throw new PhotoPrepFailure("unreadable");
}

/**
 * Some encoders write metadata even into a canvas export -- Safari on iOS adds
 * an EXIF block (APP1) to every JPEG -- and edge-api rightly refuses any photo
 * that carries one. So it is cut out here, segment by segment; the pixels are
 * untouched.
 */
async function withoutMetadata(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const clean = blob.type === "image/webp" ? stripWebpMetadata(bytes) : stripJpegMetadata(bytes);
  return new Blob([Uint8Array.from(clean)], { type: blob.type });
}

/** APP1 (EXIF/XMP), APP3-APP13 and APP15 (vendor/IPTC) and comments; keeps APP0, APP2 (ICC), APP14. */
const JPEG_DROP = new Set([
  0xe1, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xef, 0xfe,
]);

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out: number[] = [0xff, 0xd8];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return bytes;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xda) {
      // Start of scan: the rest is image data.
      for (let i = offset; i < bytes.length; i += 1) out.push(bytes[i] as number);
      return Uint8Array.from(out);
    }
    const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    if (length < 2 || offset + 2 + length > bytes.length) return bytes;
    if (!JPEG_DROP.has(marker)) {
      for (let i = offset; i < offset + 2 + length; i += 1) out.push(bytes[i] as number);
    }
    offset += 2 + length;
  }
  return bytes;
}

const WEBP_DROP = new Set(["EXIF", "XMP "]);
const ascii = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...Array.from(bytes.subarray(at, at + 4)));
const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] as number) |
    ((bytes[at + 1] as number) << 8) |
    ((bytes[at + 2] as number) << 16) |
    ((bytes[at + 3] as number) << 24)) >>>
  0;

export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WEBP") return bytes;
  const end = Math.min(bytes.length, 8 + u32(bytes, 4));
  const kept: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= end) {
    const size = u32(bytes, offset + 4);
    const next = offset + 8 + size + (size % 2);
    if (next > end) return bytes;
    const fourcc = ascii(bytes, offset);
    if (!WEBP_DROP.has(fourcc)) {
      const chunk = bytes.slice(offset, next);
      // VP8X flags: clear "has EXIF" (0x08) and "has XMP" (0x04).
      if (fourcc === "VP8X") chunk[8] = (chunk[8] as number) & ~0x0c;
      kept.push(chunk);
    }
    offset = next;
  }
  const body = kept.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(bytes.subarray(0, 12));
  const riff = 4 + body;
  out[4] = riff & 0xff;
  out[5] = (riff >>> 8) & 0xff;
  out[6] = (riff >>> 16) & 0xff;
  out[7] = (riff >>> 24) & 0xff;
  let at = 12;
  for (const chunk of kept) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export async function prepareProfilePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new PhotoPrepFailure("not_an_image");
  if (file.size > MAX_SOURCE_BYTES) throw new PhotoPrepFailure("too_large");

  let bitmap: ImageBitmap;
  try {
    // "from-image" applies the camera's rotation, so a portrait photo stays upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoPrepFailure("unreadable");
  }

  const { sx, sy, side } = centreSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE_PX;
  canvas.height = PHOTO_SIZE_PX;
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoPrepFailure("unreadable");
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, PHOTO_SIZE_PX, PHOTO_SIZE_PX);
  bitmap.close();
  return encode(canvas);
}
