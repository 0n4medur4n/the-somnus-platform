/**
 * Minimal image files for the profile-photo tests: real container structure
 * (RIFF chunks, JPEG segments), placeholder pixel data. The edge never decodes
 * pixels, it only reads the structure, so these are exactly what it inspects.
 */

function chunk(fourcc: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, "latin1");
  header.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

/** A WebP with the given chunks after an image chunk (default: just the image). */
export function webp(extraChunks: Array<[string, Buffer]> = []): Buffer {
  const body = Buffer.concat([
    Buffer.from("WEBP", "latin1"),
    chunk("VP8L", Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00])),
    ...extraChunks.map(([fourcc, data]) => chunk(fourcc, data)),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function segment(marker: number, data: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

/** A baseline JPEG: SOI, APP0 (JFIF), optionally APP1 (EXIF), DQT, SOS, data, EOI. */
export function jpeg(options: { exif?: boolean } = {}): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...(options.exif ? [segment(0xe1, Buffer.from("Exif\0\0GPS", "latin1"))] : []),
    segment(0xdb, Buffer.alloc(65)),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0xd9]),
  ]);
}
