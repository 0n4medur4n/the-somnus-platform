import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from "firebase/auth";
import { env } from "../config/env.js";
import i18n from "../i18n/index.js";
import { getFirebaseAuth } from "../lib/firebase.js";

const EMAIL_KEY = "somnus_nox_email_for_signin";

function callbackUrl(): string {
  const lng = i18n.resolvedLanguage;
  const suffix = lng ? `?lng=${encodeURIComponent(lng)}` : "";
  return `${window.location.origin}/auth/callback${suffix}`;
}

export async function sendLoginLink(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  await sendSignInLinkToEmail(auth, email, { url: callbackUrl(), handleCodeInApp: true });
  window.sessionStorage.setItem(EMAIL_KEY, email);
}

/** Puts the public web API key back on a link that arrived without it. */
export function withApiKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("oobCode") && !parsed.searchParams.has("apiKey")) {
      parsed.searchParams.set("apiKey", env.VITE_FIREBASE_API_KEY);
      return parsed.toString();
    }
  } catch {
    /* not a URL: leave it for Firebase to refuse */
  }
  return url;
}

export function isEmailLink(url: string): boolean {
  return isSignInWithEmailLink(getFirebaseAuth(), withApiKey(url));
}

export function storedEmail(): string | null {
  return window.sessionStorage.getItem(EMAIL_KEY);
}

export async function completeEmailLinkSignIn(email: string, url: string): Promise<void> {
  const auth = getFirebaseAuth();
  await signInWithEmailLink(auth, email, withApiKey(url));
  window.sessionStorage.removeItem(EMAIL_KEY);
}

export async function firebaseSignOut(): Promise<void> {
  await signOut(getFirebaseAuth());
}
