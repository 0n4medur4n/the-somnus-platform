import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNoxMe, NoxMeTimeoutError } from "./load-nox-me.js";

describe("loadNoxMe", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the body and aborts the timer", async () => {
    const signal = await new Promise<AbortSignal>((resolve, reject) => {
      void loadNoxMe((next) => {
        resolve(next);
        return Promise.resolve({ verifiedProfessional: true, noxAccess: true });
      }).catch(reject);
    });
    expect(signal.aborted).toBe(false);
  });

  it("rejects when the reader rejects", async () => {
    await expect(loadNoxMe(() => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });

  it("rejects with a timeout and aborts the signal", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const pending = loadNoxMe((signal) => {
      seen = signal;
      return new Promise(() => {});
    }, 1000);
    const assertion = expect(pending).rejects.toBeInstanceOf(NoxMeTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(seen?.aborted).toBe(true);
  });
});
