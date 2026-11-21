/**
 * Which site a session was opened from (ADR 0027 decision 8).
 *
 * Recorded at creation and not enforced. Console is only an Origin header
 * that equals the configured console origin as a string: no URL parser, no
 * case folding, no prefix, and no Referer when Origin is missing or null.
 */

export const SESSION_CLIENTS = ["console", "app"] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];

/** The sign-in this route records. A passkey ceremony is not this path. */
export const EMAIL_LINK_AMR = "email_link";

/**
 * The Origin header when it is one string. Absent stays absent. Null, and
 * anything that is not a single string (two Origin headers, for example),
 * cannot match the console origin.
 */
export function presentedOrigin(header: unknown): string | null | undefined {
  if (header === undefined) return undefined;
  if (typeof header === "string") return header;
  return null;
}

export function classifySessionClient(
  origin: string | null | undefined,
  consoleOrigin: string,
): SessionClient {
  if (origin === consoleOrigin) return "console";
  return "app";
}
