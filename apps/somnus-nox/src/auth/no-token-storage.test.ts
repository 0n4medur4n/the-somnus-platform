import { afterEach, describe, expect, it, vi } from "vitest";
import { getFirebaseAuth } from "../lib/firebase.js";

const TOKEN_KEY = /firebase:authUser|refreshToken|idToken|accessToken/i;

describe("no tokens in browser storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("initializing Firebase Auth writes no auth token to web storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(getFirebaseAuth()).toBeDefined();
    const tokenWrites = setItem.mock.calls.filter(([key]) => TOKEN_KEY.test(String(key)));
    expect(tokenWrites).toEqual([]);
    expect(Object.keys(localStorage).some((key) => TOKEN_KEY.test(key))).toBe(false);
    expect(Object.keys(sessionStorage).some((key) => TOKEN_KEY.test(key))).toBe(false);
  });
});
