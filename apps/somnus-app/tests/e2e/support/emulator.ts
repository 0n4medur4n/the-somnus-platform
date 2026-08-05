const AUTH_EMULATOR_URL = process.env["VITE_AUTH_EMULATOR_URL"] ?? "http://127.0.0.1:9099";
const PROJECT_ID = process.env["VITE_FIREBASE_PROJECT_ID"] ?? "somnus-dev-test";

type OobCode = { email: string; oobLink: string; requestType: string };

/**
 * Reads the most recent email-link sign-in URL the Auth emulator
 * generated for `email`. This stands in for the real inbox: in the
 * emulator no mail is sent, the link is retrievable from its REST API.
 */
export async function getSignInLink(email: string): Promise<string> {
  const response = await fetch(`${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  if (!response.ok) throw new Error(`emulator oobCodes fetch failed: ${response.status}`);
  const data = (await response.json()) as { oobCodes: OobCode[] };
  const match = [...data.oobCodes]
    .reverse()
    .find((code) => code.email === email && code.requestType === "EMAIL_SIGNIN");
  if (!match) throw new Error(`no sign-in link found for ${email}`);
  return match.oobLink;
}

/** A unique email per test run so repeated runs never collide on an existing user. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}
