import type { MeResponse } from "@somnus/api-contracts";

/**
 * Which experience a signed-in person gets, derived from `/v1/me` alone. This
 * only decides what is *shown*: every screen's data is still authorized by
 * edge-api and identity, so this never grants or removes access.
 */
export type AccountView = {
  /** Registration branch, or "individual" for accounts created before it was recorded. */
  kind: "adult" | "parent" | "professional" | "individual";
  /** Platform staff: the app links them to the admin console, where their work lives. */
  isStaff: boolean;
  /**
   * A Morpheo user: someone who registered for themselves or for a minor in
   * their care. They start with the Morpheo questionnaire and then have their
   * own space with their saved assessments. Professionals and Nox members
   * (organizations) have a different flow.
   */
  isMorpheoUser: boolean;
};

export function accountViewOf(me: MeResponse): AccountView {
  const kind = me.account.registrationRole ?? "individual";
  const isMorpheoUser =
    (kind === "adult" || kind === "parent" || kind === "individual") &&
    me.professionalProfile === null &&
    me.account.organizations.length === 0;
  return { kind, isStaff: me.account.internalRoles.length > 0, isMorpheoUser };
}
