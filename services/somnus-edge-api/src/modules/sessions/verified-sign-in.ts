import { EMAIL_LINK_AMR } from "./classify-session.js";

/**
 * `auth_time` on a verified Firebase ID token: seconds since the Unix epoch
 * (`DecodedIdToken.auth_time`). A missing claim or a value that is not a
 * finite number is refused. The caller reports that with the same error as a
 * bad token, and does not substitute the server clock.
 */
export function authTimeFromClaim(claim: unknown): Date | null {
  if (typeof claim !== "number" || !Number.isFinite(claim)) return null;
  const at = new Date(claim * 1000);
  if (Number.isNaN(at.getTime())) return null;
  return at;
}

/**
 * `firebase.sign_in_provider` is `"password"` for an email link and for a
 * password (firebase-admin `DecodedIdToken` lists no email-link id), so that
 * value does not say which one happened.
 *
 * This repository enables only the email link: Identity Platform turns email
 * on with `password_required = false` and phone off
 * (`google_identity_platform_config.auth`), and the app and the console sign
 * in only with `signInWithEmailLink`. An ambiguous or absent provider is
 * therefore `email_link`. Any other provider string is the method the token
 * names.
 */
export function amrFromVerifiedToken(provider: unknown): readonly string[] {
  if (typeof provider === "string" && provider.length > 0 && provider !== "password") {
    return [provider];
  }
  return [EMAIL_LINK_AMR];
}
