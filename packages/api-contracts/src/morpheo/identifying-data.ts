/**
 * The identifying-data filter for health free text (owner decision 2026-10-17;
 * the v2 free-text answers and notes, 2026-10-19).
 *
 * A note is health free text the person writes; the flow must never hold who
 * they are (build plan §14 "privacy in the flow"). Notes that contain an email
 * address, a phone number, or a Spanish DNI/NIE are refused before they are
 * stored. The SPA runs it as the person types (to explain), the edge runs it
 * through the Zod contract (to refuse), and morpheo runs the same patterns in
 * Python (`morpheo.domain.identifying_data`); the shared cases in
 * schemas/fixtures/identifying-data.json keep the two languages identical.
 *
 * It is a net for the obvious, not an anonymiser: names and dates of birth
 * cannot be told apart from ordinary words and dates, so the screen also tells
 * the person not to write them.
 */

/** The longest free-text answer or note accepted (v2: Q01 narrative included). */
export const FREE_TEXT_MAX_LENGTH = 2000;

export const IDENTIFYING_DATA_KINDS = ["email", "phone", "national_id"] as const;
export type IdentifyingDataKind = (typeof IDENTIFYING_DATA_KINDS)[number];

// The DNI/NIE control letter is any letter but I, Ñ, O and U.
const CONTROL_LETTER = "[A-HJ-NP-TV-Za-hj-np-tv-z]";

const PATTERNS: Record<IdentifyingDataKind, readonly RegExp[]> = {
  email: [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  phone: [
    // A Spanish number: nine digits starting 6-9, optional +34 / 0034, digits
    // optionally grouped by spaces, dots or dashes.
    /(?<![0-9])(?:(?:\+|00)[0-9]{1,3}[\s.-]?)?[6-9](?:[\s.-]?[0-9]){8}(?![0-9])/,
    // Any number written with an international prefix.
    /(?<![0-9])(?:\+|00)[0-9](?:[\s.-]?[0-9]){7,14}(?![0-9])/,
  ],
  national_id: [
    // `\\s` inside a template string: a bare `\s` there would lose its backslash
    // and match the letter "s" instead of a space.
    new RegExp(`(?<![A-Za-z0-9])[0-9]{8}[\\s-]?${CONTROL_LETTER}(?![A-Za-z0-9])`),
    new RegExp(`(?<![A-Za-z0-9])[XYZxyz][\\s-]?[0-9]{7}[\\s-]?${CONTROL_LETTER}(?![A-Za-z0-9])`),
  ],
};

/** Which kinds of identifying data the text contains (empty when none). */
export function findIdentifyingData(text: string): IdentifyingDataKind[] {
  return IDENTIFYING_DATA_KINDS.filter((kind) =>
    PATTERNS[kind].some((pattern) => pattern.test(text)),
  );
}
