/**
 * Where to land after signing in, when sign-in was asked for by a Drive link
 * (owner decision 2026-10-29). Only an address inside `/drive` is kept -- ids,
 * never content -- and only for half an hour. localStorage rather than
 * sessionStorage because the sign-in email usually opens in a new tab.
 */
const KEY = "somnus.returnTo";
const TTL_MS = 30 * 60 * 1000;

function isDrivePath(path: unknown): path is string {
  return typeof path === "string" && /^\/drive(?:[/?]|$)/.test(path) && !path.startsWith("//");
}

export function rememberReturnTo(path: string): void {
  if (!isDrivePath(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage unavailable: the person lands on the console instead.
  }
}

/** The remembered Drive address, once; null when there is none or it is stale. */
export function takeReturnTo(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (!isDrivePath(path) || typeof at !== "number" || Date.now() - at > TTL_MS) return null;
    return path;
  } catch {
    return null;
  }
}
