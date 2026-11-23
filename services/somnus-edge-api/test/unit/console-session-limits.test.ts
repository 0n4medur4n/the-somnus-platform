import { describe, expect, it } from "vitest";
import {
  CONSOLE_ABSOLUTE_MS,
  CONSOLE_IDLE_MS,
  consoleAccess,
  LAST_SEEN_INTERVAL_MS,
} from "../../src/modules/sessions/session.service.js";

const start = new Date("2026-11-23T12:00:00.000Z");

describe("console session limits", () => {
  it("fails closed when authTime was never stored", () => {
    expect(consoleAccess(start, undefined, undefined)).toEqual({ ok: false });
  });

  it("rejects the instant idle reaches 30 minutes, measured from authTime when nothing was seen", () => {
    const justInside = new Date(start.getTime() + CONSOLE_IDLE_MS - 1);
    const atLimit = new Date(start.getTime() + CONSOLE_IDLE_MS);
    expect(consoleAccess(justInside, start, undefined)).toEqual({ ok: true, writeLastSeen: true });
    expect(consoleAccess(atLimit, start, undefined)).toEqual({ ok: false });
  });

  it("rejects the instant authTime is 10 hours old, even if the session was just seen", () => {
    const justInside = new Date(start.getTime() + CONSOLE_ABSOLUTE_MS - 1);
    const atLimit = new Date(start.getTime() + CONSOLE_ABSOLUTE_MS);
    expect(consoleAccess(justInside, start, justInside).ok).toBe(true);
    expect(consoleAccess(atLimit, start, atLimit)).toEqual({ ok: false });
  });

  it("asks for a lastSeenAt write only when the stored one is absent or at least a minute old", () => {
    const recent = new Date(start.getTime() + LAST_SEEN_INTERVAL_MS - 1);
    const due = new Date(start.getTime() + LAST_SEEN_INTERVAL_MS);
    expect(consoleAccess(recent, start, start)).toEqual({ ok: true, writeLastSeen: false });
    expect(consoleAccess(due, start, start)).toEqual({ ok: true, writeLastSeen: true });
  });
});
