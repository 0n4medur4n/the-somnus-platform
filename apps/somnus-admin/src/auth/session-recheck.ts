import { ApiRequestError } from "../lib/api.js";

/**
 * How long a tab can sit hidden, or the Drive can sit untouched, before we
 * ask who is signed in. The same 15 minutes as the Drive's own lock.
 */
export const DRIVE_IDLE_LOCK_MS = 15 * 60 * 1000;

/** True when the tab has been hidden at least `limit` milliseconds. */
export function hiddenLongEnough(
  hiddenAt: number | null,
  now: number,
  limit = DRIVE_IDLE_LOCK_MS,
): boolean {
  return hiddenAt !== null && now - hiddenAt >= limit;
}

/**
 * Ask `/admin/v1/me` before the person can type again.
 *
 * Always asks once. On 401, and only when nothing unsaved is open, calls
 * `onUnauthenticated` and returns false so the console shows the sign-in
 * screen. Unsaved work stays where it is: that screen would unmount the editor.
 */
export async function confirmSessionBeforeTyping(input: {
  unsaved: boolean;
  me: () => Promise<unknown>;
  onUnauthenticated: () => void;
}): Promise<boolean> {
  try {
    await input.me();
    return true;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401 && !input.unsaved) {
      input.onUnauthenticated();
      return false;
    }
    return true;
  }
}
