/**
 * TEMPORARY dev/test stand-in for GET /nox/v1/me.
 * Vite aliases @nox-me-source to this file except when mode is production.
 * NOX_DEV_MOCK_SENTINEL must appear in this module's executable body so a
 * production bundle that accidentally includes it fails the build test.
 */

export const NOX_DEV_MOCK_SENTINEL = "NOX_DEV_MOCK_SENTINEL";

export function devPreview(): "dashboard" | "denied" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("preview");
  if (value === "dashboard" || value === "denied") return value;
  return null;
}

export async function fetchNoxMe(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error(NOX_DEV_MOCK_SENTINEL);
  const preview = devPreview();
  if (preview === "denied") return { verifiedProfessional: false, noxAccess: false };
  return { verifiedProfessional: true, noxAccess: true };
}
