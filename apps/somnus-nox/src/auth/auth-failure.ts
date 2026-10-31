/**
 * What the auth callback may tell someone when the emailed link fails.
 * link-invalid is only the Firebase codes that mean the link itself is
 * unusable. Everything else stays generic and does not invent a cause.
 */
export type CallbackFailure = "link-invalid" | "generic";

const LINK_FAILURE_CODES: ReadonlySet<string> = new Set([
  "auth/invalid-action-code",
  "auth/expired-action-code",
]);

function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("auth/") ? code : null;
}

export function classifyCallbackFailure(error: unknown): CallbackFailure {
  const code = authErrorCode(error);
  return code !== null && LINK_FAILURE_CODES.has(code) ? "link-invalid" : "generic";
}
