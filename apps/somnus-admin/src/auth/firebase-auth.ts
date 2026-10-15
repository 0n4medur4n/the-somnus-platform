import { isSupportedLocale } from "@somnus/api-contracts";
import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from "firebase/auth";
import { env } from "../config/env.js";
import i18n from "../i18n/index.js";
import { edge } from "../lib/edge.js";
import { getFirebaseAuth } from "../lib/firebase.js";

/**
 * The email (NOT a token) needed to complete sign-in on the callback
 * page load. sessionStorage is acceptable -- it holds no credential and
 * is cleared as soon as sign-in completes. The no-token-storage test
 * asserts no Firebase auth token ever lands in any storage.
 */
const EMAIL_KEY = "somnus_email_for_signin";

function callbackUrl(): string {
  // Carry the active language through the email link so the callback
  // (a fresh page load, opened from the user's inbox) renders in the
  // same locale the user started in, rather than the browser default.
  const lng = i18n.resolvedLanguage;
  const suffix = lng ? `?lng=${encodeURIComponent(lng)}` : "";
  return `${window.location.origin}/auth/callback${suffix}`;
}

export async function sendLoginLink(email: string): Promise<void> {
  if (env.VITE_SIGN_IN_EMAIL === "somnus") {
    const lng = i18n.resolvedLanguage;
    await edge.requestSignInLink({
      email,
      locale: lng && isSupportedLocale(lng) ? lng : "es",
      client: "console",
    });
  } else {
    const auth = getFirebaseAuth();
    await sendSignInLinkToEmail(auth, email, { url: callbackUrl(), handleCodeInApp: true });
  }
  window.sessionStorage.setItem(EMAIL_KEY, email);
}

/**
 * The link we email carries only the one-time code (see edge-api's
 * auth-email-link). The Firebase SDK also expects the project's web API key in
 * the link -- public by design, it is in this bundle anyway -- so it is added
 * back here, in the browser, instead of travelling in every email.
 */
export function withApiKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("oobCode") && !parsed.searchParams.has("apiKey")) {
      parsed.searchParams.set("apiKey", env.VITE_FIREBASE_API_KEY);
      return parsed.toString();
    }
  } catch {
    /* not a URL: leave it to Firebase to refuse */
  }
  return url;
}

export function isEmailLink(url: string): boolean {
  return isSignInWithEmailLink(getFirebaseAuth(), withApiKey(url));
}

export function storedEmail(): string | null {
  return window.sessionStorage.getItem(EMAIL_KEY);
}

/** Completes the email-link sign-in and returns a fresh Firebase ID token. */
export async function completeEmailLinkSignIn(email: string, url: string): Promise<string> {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailLink(auth, email, withApiKey(url));
  window.sessionStorage.removeItem(EMAIL_KEY);
  return credential.user.getIdToken();
}

export async function firebaseSignOut(): Promise<void> {
  await signOut(getFirebaseAuth());
}
