import { describe, expect, it } from "vitest";
import {
  centreSquare,
  MAX_SOURCE_BYTES,
  PhotoPrepFailure,
  prepareProfilePhoto,
  stripJpegMetadata,
  stripWebpMetadata,
} from "./photo.js";

describe("centreSquare", () => {
  it("cuts the centred square out of a landscape and a portrait photo", () => {
    expect(centreSquare(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(centreSquare(3000, 4000)).toEqual({ sx: 0, sy: 500, side: 3000 });
    expect(centreSquare(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 });
  });
});

describe("prepareProfilePhoto", () => {
  it("refuses a file that is not an image before reading it", async () => {
    const pdf = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    await expect(prepareProfilePhoto(pdf)).rejects.toMatchObject({ reason: "not_an_image" });
  });

  it("refuses an image over the size limit before reading it", async () => {
    const huge = new File([new Uint8Array(MAX_SOURCE_BYTES + 1)], "huge.jpg", {
      type: "image/jpeg",
    });
    await expect(prepareProfilePhoto(huge)).rejects.toBeInstanceOf(PhotoPrepFailure);
    await expect(prepareProfilePhoto(huge)).rejects.toMatchObject({ reason: "too_large" });
  });
});

/** A JPEG made of SOI, the given segments, SOS + 2 data bytes, EOI. */
function jpegOf(...segments: [marker: number, payload: string][]): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (const [marker, payload] of segments) {
    const body = Array.from(payload, (c) => c.charCodeAt(0));
    const length = body.length + 2;
    parts.push(0xff, marker, length >> 8, length & 0xff, ...body);
  }
  parts.push(0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9);
  return Uint8Array.from(parts);
}

const has = (bytes: Uint8Array, text: string) =>
  String.fromCharCode(...Array.from(bytes)).includes(text);

describe("stripJpegMetadata (Safari writes EXIF into canvas JPEGs)", () => {
  it("removes EXIF/XMP, vendor blocks and comments, and keeps JFIF, ICC and the pixels", () => {
    const original = jpegOf(
      [0xe0, "JFIF\0"],
      [0xe1, "Exif\0\0GPS"],
      [0xe2, "ICC_PROFILE\0"],
      [0xed, "Photoshop 3.0"],
      [0xfe, "a comment"],
      [0xdb, "QT"],
    );
    const clean = stripJpegMetadata(original);
    expect(has(clean, "Exif")).toBe(false);
    expect(has(clean, "Photoshop")).toBe(false);
    expect(has(clean, "a comment")).toBe(false);
    expect(has(clean, "JFIF")).toBe(true);
    expect(has(clean, "ICC_PROFILE")).toBe(true);
    // The scan and the end-of-image marker are intact.
    expect(Array.from(clean.slice(-6))).toEqual([0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  });

  it("leaves a clean JPEG byte for byte, and anything it cannot parse untouched", () => {
    const clean = jpegOf([0xe0, "JFIF\0"], [0xdb, "QT"]);
    expect(stripJpegMetadata(clean)).toEqual(clean);
    const garbage = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(stripJpegMetadata(garbage)).toBe(garbage);
  });
});

function chunk(fourcc: string, payload: number[]): number[] {
  const size = payload.length;
  const body = [...payload, ...(size % 2 ? [0] : [])];
  return [
    ...Array.from(fourcc, (c) => c.charCodeAt(0)),
    size & 0xff,
    (size >> 8) & 0xff,
    0,
    0,
    ...body,
  ];
}

function webpOf(...chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  const riff = 4 + body.length;
  return Uint8Array.from([
    ...Array.from("RIFF", (c) => c.charCodeAt(0)),
    riff & 0xff,
    (riff >> 8) & 0xff,
    0,
    0,
    ...Array.from("WEBP", (c) => c.charCodeAt(0)),
    ...body,
  ]);
}

describe("stripWebpMetadata", () => {
  it("drops EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size", () => {
    const vp8x = [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const original = webpOf(
      chunk("VP8X", vp8x),
      chunk("VP8 ", [1, 2, 3, 4]),
      chunk("EXIF", [9, 9, 9]),
      chunk("XMP ", [8, 8]),
    );
    const clean = stripWebpMetadata(original);
    expect(has(clean, "EXIF")).toBe(false);
    expect(has(clean, "XMP ")).toBe(false);
    expect(has(clean, "VP8 ")).toBe(true);
    expect(clean[20]).toBe(0); // VP8X flags byte, metadata bits cleared
    const riff = (clean[4] as number) | ((clean[5] as number) << 8);
    expect(riff).toBe(clean.length - 8);
  });
});
