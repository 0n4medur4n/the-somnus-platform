import type { InvitationPreviewResponse } from "@somnus/api-contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { sendLoginLink } from "../auth/firebase-auth.js";
import { useAuth } from "../auth/useAuth.js";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { AuthLayout } from "../layouts/AuthLayout.js";
import { ApiRequestError } from "../lib/api.js";
import { edge } from "../lib/edge.js";
import { forgetInvitation, rememberInvitation } from "../lib/invitation.js";

/**
 * The only way into a Nox organization (Addendum A §A1 / Checkpoint 14.2).
 *
 * There is no Nox signup page: this screen is reached from the invitation
 * email and nowhere else. It is public because the invited person has no
 * session yet -- the whole point is to tell them, before any magic link is
 * sent, whether the invitation is still usable.
 *
 * An unusable invitation is terminal. It says which thing went wrong and
 * stops. It never offers a way to register anyway, because open registration
 * would not get them into the organization and Nox has no other door.
 */
type Phase = "checking" | "ready" | "linkSent" | "accepted" | "unusable";

/** Maps edge-api's stable §16 error codes to localized copy. */
const ERROR_KEYS: Record<string, string> = {
  INVITATION_EXPIRED: "invitation.errors.expired",
  INVITATION_ALREADY_USED: "invitation.errors.alreadyUsed",
  INVITATION_NOT_FOUND: "invitation.errors.notFound",
  INVITATION_EMAIL_MISMATCH: "invitation.errors.emailMismatch",
};

function errorKey(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return ERROR_KEYS[err.code] ?? fallback;
  return fallback;
}

export function InvitationAccept() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state, refresh } = useAuth();
  const token = params.get("token") ?? "";

  const [phase, setPhase] = useState<Phase>("checking");
  const [invitation, setInvitation] = useState<InvitationPreviewResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const looked = useRef(false);

  useEffect(() => {
    if (looked.current) return;
    looked.current = true;

    if (!token) {
      setErrorMessage(t("invitation.errors.missingToken"));
      setPhase("unusable");
      return;
    }

    void (async () => {
      try {
        const preview = await edge.previewInvitation({ token });
        setInvitation(preview);
        setPhase("ready");
      } catch (err) {
        // A dead invitation is dead for good: drop the parked token so no
        // later screen keeps trying to use it.
        forgetInvitation();
        setErrorMessage(t(errorKey(err, "invitation.errors.generic")));
        setPhase("unusable");
      }
    })();
  }, [token, t]);

  // A signed-in-but-unregistered person finishes registration first; the
  // callback sends them back here afterwards to accept.
  useEffect(() => {
    if (phase === "ready" && state.status === "needs-registration") {
      rememberInvitation(token);
      navigate("/auth/callback", { replace: true });
    }
  }, [phase, state.status, token, navigate]);

  async function onContinue(): Promise<void> {
    if (!invitation) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      // Park the token so it survives the trip through the inbox, then send
      // the magic link to the invited address -- never to one the visitor
      // typed, which the invitation would refuse anyway.
      rememberInvitation(token);
      await sendLoginLink(invitation.email);
      setPhase("linkSent");
    } catch {
      setErrorMessage(t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onAccept(): Promise<void> {
    setBusy(true);
    setErrorMessage(null);
    try {
      await edge.acceptInvitation({ token });
      forgetInvitation();
      await refresh();
      setPhase("accepted");
    } catch (err) {
      setErrorMessage(t(errorKey(err, "invitation.errors.acceptFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (phase === "checking" || state.status === "loading") {
    return <FullPageStatus message={t("invitation.checking")} />;
  }

  if (phase === "unusable") {
    return (
      <AuthLayout>
        <div className="rounded-2xl border border-somnus-danger/30 bg-somnus-surface p-6 shadow-lg shadow-black/20">
          <h1 className="text-2xl font-semibold text-somnus-text">{t("invitation.errorTitle")}</h1>
          <p role="alert" className="mt-2 text-somnus-danger">
            {errorMessage}
          </p>
          {/* Deliberately no link to login or registration: an open account
              would not join them to the organization (Addendum A §A1). */}
          <p className="mt-4 text-sm text-somnus-subtle">{t("invitation.noOpenSignup")}</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-4 rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        <h1 className="text-2xl font-semibold text-somnus-text">{t("invitation.title")}</h1>
        <p className="text-somnus-subtle">
          {t("invitation.invitedTo", { organization: invitation?.organizationName ?? "" })}
        </p>

        {phase === "accepted" ? (
          <>
            <p role="status" aria-live="polite" className="text-somnus-success">
              {t("invitation.accepted", { organization: invitation?.organizationName ?? "" })}
            </p>
            <Link
              to="/app"
              className="text-somnus-primary underline underline-offset-2 hover:brightness-110"
            >
              {t("invitation.goToApp")}
            </Link>
          </>
        ) : phase === "linkSent" ? (
          <p role="status" aria-live="polite" className="text-somnus-text">
            {t("invitation.linkSent", { email: invitation?.email ?? "" })}
          </p>
        ) : (
          <>
            {/* Read-only: the invitation is bound to this address, and identity
                rejects an accept from any other account. */}
            <Field
              id="invitation-email"
              label={t("invitation.emailLabel")}
              hint={t("invitation.emailLocked")}
              type="email"
              readOnly
              value={invitation?.email ?? ""}
            />
            {errorMessage ? (
              <p role="alert" className="text-somnus-danger">
                {errorMessage}
              </p>
            ) : null}
            {state.status === "authenticated" ? (
              <Button
                type="button"
                disabled={busy}
                className="w-full"
                onClick={() => void onAccept()}
              >
                {t("invitation.acceptCta", { organization: invitation?.organizationName ?? "" })}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busy}
                className="w-full"
                onClick={() => void onContinue()}
              >
                {t("invitation.continueCta")}
              </Button>
            )}
          </>
        )}
      </div>
    </AuthLayout>
  );
}
