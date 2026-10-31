/** Production GET /nox/v1/me. No fixture data lives in this file. */

export function devPreview(): "dashboard" | "denied" | null {
  return null;
}

export async function fetchNoxMe(signal: AbortSignal): Promise<unknown> {
  const response = await fetch("/nox/v1/me", {
    method: "GET",
    signal,
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("nox-me-rejected");
  const body: unknown = await response.json();
  return body;
}
