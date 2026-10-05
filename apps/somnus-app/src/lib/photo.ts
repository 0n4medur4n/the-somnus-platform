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
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg");
  if (jpeg?.type === "image/jpeg") return jpeg;
  throw new PhotoPrepFailure("unreadable");
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
