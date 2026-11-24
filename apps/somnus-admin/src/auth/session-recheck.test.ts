import { afterEach, describe, expect, it, vi } from "vitest";
import { resetUnsavedForTests } from "../drive/unsaved.js";
import { ApiRequestError } from "../lib/api.js";
import { confirmSessionBeforeTyping, hiddenLongEnough } from "./session-recheck.js";

afterEach(() => {
  resetUnsavedForTests();
});

describe("confirmSessionBeforeTyping", () => {
  it("sends the person to the sign-in screen on 401 when nothing is unsaved", async () => {
    const me = vi.fn().mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "no"));
    const onUnauthenticated = vi.fn();
    const allowed = await confirmSessionBeforeTyping({
      unsaved: false,
      me,
      onUnauthenticated,
    });
    expect(me).toHaveBeenCalledTimes(1);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(false);
  });

  it("asks once and leaves an unsaved editor mounted when the session is gone", async () => {
    const me = vi.fn().mockRejectedValue(new ApiRequestError(401, "UNAUTHENTICATED", "no"));
    const onUnauthenticated = vi.fn();
    const allowed = await confirmSessionBeforeTyping({
      unsaved: true,
      me,
      onUnauthenticated,
    });
    expect(me).toHaveBeenCalledTimes(1);
    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(allowed).toBe(true);
  });

  it("treats a hidden tab as a long idle only after the Drive's own lock time", () => {
    expect(hiddenLongEnough(1_000, 1_000 + 15 * 60 * 1000 - 1)).toBe(false);
    expect(hiddenLongEnough(1_000, 1_000 + 15 * 60 * 1000)).toBe(true);
  });
});
