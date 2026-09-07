import { afterEach, describe, expect, it, vi } from "vitest";
import { getFirebaseAuth } from "../lib/firebase.js";

/**
 * Build plan §5.2 / §10: the SPA must persist NO auth token in the
 * browser. Firebase is configured with in-memory persistence, so
 * initializing (and, in the E2E, signing in) never writes a token to
 * localStorage/IndexedDB. This is the unit-level guard; the E2E asserts
 * the same after a real sign-in.
 */
const TOKEN_KEY = /firebase:authUser|refreshToken|idToken|accessToken/i;

describe("no tokens in browser storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("initializing Firebase Auth writes no auth token to web storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const auth = getFirebaseAuth();
    expect(auth).toBeDefined();

    const tokenWrites = setItem.mock.calls.filter(([key]) => TOKEN_KEY.test(String(key)));
    expect(tokenWrites).toEqual([]);
    expect(Object.keys(localStorage).some((k) => TOKEN_KEY.test(k))).toBe(false);
    expect(Object.keys(sessionStorage).some((k) => TOKEN_KEY.test(k))).toBe(false);
  });
});
