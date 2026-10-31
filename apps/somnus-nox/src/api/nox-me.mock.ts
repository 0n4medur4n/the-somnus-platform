/**
 * TEMPORARY stand-in for GET /nox/v1/me.
 * Aliased only when Vite's mode is development or test.
 * NOX_DEV_MOCK_SENTINEL and the ?preview= bypass must stay in this file's
 * executable body so a bundle that includes the mock fails the build test.
 */

export const NOX_DEV_MOCK_SENTINEL = "NOX_DEV_MOCK_SENTINEL";

/** Query bypass. The bundle test searches for this exact string. */
const PREVIEW_BYPASS = "?preview=";

export function devPreview(): "dashboard" | "denied" | null {
  if (typeof window === "undefined") return null;
  const search = window.location.search;
  if (!search.includes(PREVIEW_BYPASS.slice(1))) return null;
  const value = new URLSearchParams(search).get(PREVIEW_BYPASS.slice(1, -1));
  if (value === "dashboard" || value === "denied") return value;
  return null;
}

export async function fetchNoxMe(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error(NOX_DEV_MOCK_SENTINEL);
  const preview = devPreview();
  if (preview === "denied") return { verifiedProfessional: false, noxAccess: false };
  return { verifiedProfessional: true, noxAccess: true };
}
