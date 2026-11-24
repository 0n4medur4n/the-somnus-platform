import { useEffect, useRef } from "react";
import { onConsoleSession } from "../auth/session-channel.js";

/**
 * How many open editors (or uploads) still hold text that is not on the server.
 * A counter in this module, not in browser storage: the plaintext never leaves memory.
 */
let holders = 0;

export function holdUnsaved(): () => void {
  holders += 1;
  return () => {
    holders = Math.max(0, holders - 1);
  };
}

export function driveHasUnsaved(): boolean {
  return holders > 0;
}

/** Test helper. Production code only uses holdUnsaved. */
export function resetUnsavedForTests(): void {
  holders = 0;
}

export function leaveWarningActive(status: string): boolean {
  return status === "dirty" || status === "saving" || status === "error" || status === "expired";
}

export function useDraftHold(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) return;
    return holdUnsaved();
  }, [unsaved]);
}

/** One retry of a save that is waiting on a new session. Further signals retry again, once each. */
export function usePendingSaveRetry(status: string, save: () => void): void {
  const statusRef = useRef(status);
  const saveRef = useRef(save);
  statusRef.current = status;
  saveRef.current = save;
  useEffect(
    () =>
      onConsoleSession(() => {
        if (statusRef.current === "expired") saveRef.current();
      }),
    [],
  );
}
