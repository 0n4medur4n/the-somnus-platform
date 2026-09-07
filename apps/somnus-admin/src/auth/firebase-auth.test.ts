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
