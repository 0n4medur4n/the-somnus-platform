/**
 * Every Drive document has a code of its own (owner decision 2026-11-02),
 * shown beside its title and printed on every export: the SHA-256 of its Drive
 * file identifier, as SMN-XXXX-XXXX-XXXX-XXXX. Two documents never share one,
 * and a document keeps its code through every revision; a copy or a re-import
 * is another file, so it gets another code.
 *
 * An export also carries a fingerprint: the SHA-256 of exactly what was
 * exported (title, text, header and footer), so two exports of the same code
 * show whether their contents are the same.
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function grouped(hex: string): string {
  return (hex.slice(0, 16).toUpperCase().match(/.{4}/g) ?? []).join("-");
}

export async function documentCode(fileId: string): Promise<string> {
  return `SMN-${grouped(await sha256Hex(`somnus-drive-document:${fileId}`))}`;
}

/** The fingerprint of one export: the same contents always give the same one. */
export async function contentFingerprint(contents: unknown): Promise<string> {
  return grouped(await sha256Hex(JSON.stringify(contents)));
}
