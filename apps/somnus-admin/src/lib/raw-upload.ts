/**
 * A request body sent as raw bytes with its own content type and headers -- a
 * file, never JSON. Kept apart from `api.ts` so a test can replace the transport
 * without losing the value type.
 */
export class RawUpload {
  constructor(
    readonly bytes: Blob,
    readonly contentType: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {}
}
