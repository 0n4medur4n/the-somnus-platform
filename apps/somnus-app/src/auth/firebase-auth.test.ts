import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendSignInLinkToEmail: vi.fn(),
  isSignInWithEmailLink: vi.fn(),
  signInWithEmailLink: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("firebase/auth", () => mocks);
vi.mock("../lib/firebase.js", () => ({ getFirebaseAuth: () => ({ name: "test-auth" }) }));

const { sendLoginLink, isEmailLink, storedEmail, completeEmailLinkSignIn, firebaseSignOut } =
  await import("./firebase-auth.js");

describe("firebase-auth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it("sendLoginLink sends an email link and stashes the email (not a token)", async () => {
    mocks.sendSignInLinkToEmail.mockResolvedValue(undefined);
    await sendLoginLink("user@example.com");
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledWith(
      { name: "test-auth" },
      "user@example.com",
      expect.objectContaining({ handleCodeInApp: true }),
    );
    expect(storedEmail()).toBe("user@example.com");
  });

  it("isEmailLink delegates to Firebase", () => {
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    expect(isEmailLink("https://app/auth/callback?...")).toBe(true);
  });

  it("completeEmailLinkSignIn returns a fresh ID token and clears the stored email", async () => {
    sessionStorage.setItem("somnus_email_for_signin", "user@example.com");
    mocks.signInWithEmailLink.mockResolvedValue({
      user: { getIdToken: async () => "fresh-token" },
    });
    const token = await completeEmailLinkSignIn("user@example.com", "https://app/auth/callback");
    expect(token).toBe("fresh-token");
    expect(storedEmail()).toBeNull();
  });

  it("firebaseSignOut delegates to Firebase", async () => {
    mocks.signOut.mockResolvedValue(undefined);
    await firebaseSignOut();
    expect(mocks.signOut).toHaveBeenCalled();
  });
});

describe("sign-in link sent by The Somnus (VITE_SIGN_IN_EMAIL=somnus)", () => {
  it("asks edge-api for the link, in the current language, and never calls Firebase's mailer", async () => {
    vi.resetModules();
    const requestSignInLink = vi.fn().mockResolvedValue(undefined);
    const sendSignInLinkToEmail = vi.fn();
    vi.doMock("firebase/auth", () => ({ ...mocks, sendSignInLinkToEmail }));
    vi.doMock("../config/env.js", () => ({
      env: { VITE_SIGN_IN_EMAIL: "somnus", VITE_FIREBASE_API_KEY: "AIzaPUBLIC" },
    }));
    vi.doMock("../lib/edge.js", () => ({ edge: { requestSignInLink } }));
    const fresh = await import("./firebase-auth.js");
    const { default: freshI18n } = await import("../i18n/index.js");
    await freshI18n.changeLanguage("ca");

    await fresh.sendLoginLink("ada@example.com");

    expect(requestSignInLink).toHaveBeenCalledWith({ email: "ada@example.com", locale: "ca" });
    expect(sendSignInLinkToEmail).not.toHaveBeenCalled();
    expect(fresh.storedEmail()).toBe("ada@example.com");

    // The emailed link has only the code; the public key is added back in the browser.
    expect(
      fresh.withApiKey("https://app.thesomnus.com/auth/callback?mode=signIn&oobCode=C&lng=es"),
    ).toBe(
      "https://app.thesomnus.com/auth/callback?mode=signIn&oobCode=C&lng=es&apiKey=AIzaPUBLIC",
    );
    // A Firebase-built link already has its key and is left alone.
    const full = "https://x.firebaseapp.com/__/auth/action?apiKey=K&mode=signIn&oobCode=C";
    expect(fresh.withApiKey(full)).toBe(full);
    // Not a sign-in link: untouched.
    expect(fresh.withApiKey("https://app.thesomnus.com/app")).toBe("https://app.thesomnus.com/app");

    vi.doUnmock("firebase/auth");
    vi.doUnmock("../config/env.js");
    vi.doUnmock("../lib/edge.js");
  });
});
