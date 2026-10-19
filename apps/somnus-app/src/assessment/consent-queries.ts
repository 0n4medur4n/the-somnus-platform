import type { SupportedLocale } from "@somnus/api-contracts";

/** The current legal documents in a language (shared by the v1 and v2 flows). */
export const legalDocumentsQuery = (locale: SupportedLocale) =>
  ["legal-documents", locale] as const;
/** The signed-in person's consents in force. */
export const CONSENT_STATUS_QUERY = ["consent-status"] as const;
/** Where a health-data consent given in the questionnaire is recorded from. */
export const CONSENT_SOURCE = "morpheo-assessment";
