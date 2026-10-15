import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { opaqueIdSchema } from "../uuid.js";
import { ConsentPurposeKeySchema } from "./consent-purpose.js";

/**
 * One row per published version of the document backing a purpose
 * (build plan §13: every consent receipt references a specific
 * document version). `version` is a monotonically increasing integer
 * per purpose, not a semver string -- version supersession is a
 * strictly-greater-than comparison, nothing fuzzier.
 */
export const LegalDocumentVersionSchema = z.object({
  id: opaqueIdSchema,
  purposeKey: ConsentPurposeKeySchema,
  /** The document's name, e.g. "Health Data Processing Policy". */
  title: z.string().min(1),
  version: z.number().int().min(1),
  /**
   * The language the text is in. A receipt always binds to the default-locale
   * (es) version, so a consent screen shows that text: what is read is what is
   * signed.
   */
  locale: LocaleSchema,
  content: z.string().min(1),
  /**
   * SHA-256 (hex) of `content` exactly as stored. A version is never edited
   * (a change is a new version), so this fingerprint identifies the text a
   * receipt refers to and lets anyone check a printed copy against it.
   */
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  effectiveAt: z.iso.datetime(),
});
export type LegalDocumentVersion = z.infer<typeof LegalDocumentVersionSchema>;

/** GET /v1/legal-documents/current -- the current published version of every purpose's document, in one locale. */
export const CurrentLegalDocumentsResponseSchema = z.object({
  documents: z.array(LegalDocumentVersionSchema),
});
export type CurrentLegalDocumentsResponse = z.infer<typeof CurrentLegalDocumentsResponseSchema>;
