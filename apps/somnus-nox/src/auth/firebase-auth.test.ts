import { afterEach, describe, expect, it, vi } from "vitest";

const sendSignInLinkToEmail = vi.fn();
const signInWithEmailLink = vi.fn();
const signOut = vi.fn();
const isSignInWithEmailLink = vi.fn();

vi.mock("firebase/auth", () => ({
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  isSignInWithEmailLink,
}));

vi.mock("../lib/firebase.js", () => ({
  getFirebaseAuth: () => ({ name: "auth" }),
}));

const { completeEmailLinkSignIn, isEmailLink, sendLoginLink, storedEmail, withApiKey } =
  await import("./firebase-auth.js");

describe("firebase magic link", () => {
  afterEach(() => {
    sendSignInLinkToEmail.mockReset();
    signInWithEmailLink.mockReset();
    signOut.mockReset();
    isSignInWithEmailLink.mockReset();
    sessionStorage.clear();
  });

  it("stores only the email, not a token, and builds a same-origin callback", async () => {
    await sendLoginLink("person@example.com");
    expect(sessionStorage.getItem("somnus_nox_email_for_signin")).toBe("person@example.com");
    expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
      { name: "auth" },
      "person@example.com",
      expect.objectContaining({
        handleCodeInApp: true,
        url: expect.stringContaining("/auth/callback"),
      }),
    );
    const url = sendSignInLinkToEmail.mock.calls[0]?.[2] as { url: string } | undefined;
    expect(url?.url.startsWith(window.location.origin)).toBe(true);
    expect(storedEmail()).toBe("person@example.com");
  });

  it("adds the public api key only when the link has a code and none yet", () => {
    const withCode = withApiKey("https://nox.example/auth/callback?oobCode=abc");
    expect(new URL(withCode).searchParams.get("apiKey")).toBe("demo-api-key");
    const already = withApiKey("https://nox.example/auth/callback?oobCode=abc&apiKey=keep");
    expect(new URL(already).searchParams.get("apiKey")).toBe("keep");
    expect(withApiKey("not a url")).toBe("not a url");
  });

  it("completes the link and forgets the stored email", async () => {
    sessionStorage.setItem("somnus_nox_email_for_signin", "person@example.com");
    isSignInWithEmailLink.mockReturnValue(true);
    signInWithEmailLink.mockResolvedValue({});
    expect(isEmailLink("https://nox.example/auth/callback?oobCode=abc")).toBe(true);
    await completeEmailLinkSignIn("person@example.com", "https://nox.example/?oobCode=abc");
    expect(storedEmail()).toBeNull();
    expect(signInWithEmailLink).toHaveBeenCalled();
  });

  it("signs out", async () => {
    await signOut.mockResolvedValue(undefined);
    const { firebaseSignOut } = await import("./firebase-auth.js");
    await firebaseSignOut();
    expect(signOut).toHaveBeenCalled();
  });
});
