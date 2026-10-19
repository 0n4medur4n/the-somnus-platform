import type { RegistrationRequest } from "@somnus/api-contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "../components/Button.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { AuthLayout } from "../layouts/AuthLayout.js";
import { ApiRequestError } from "../lib/api.js";
import { edge } from "../lib/edge.js";
import { RegistrationForm } from "./AuthCallback.js";

/** The id is a locator, never identity proof; edge binds every call to the session's address. */
export function PlatformInvitationEntry({
  invitationId,
  existing,
  onJoined,
}: {
  invitationId: string;
  existing: boolean;
  onJoined: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const invitation = useQuery({
    queryKey: ["platformInvitation", invitationId],
    queryFn: () => edge.platformInvitation(invitationId),
    retry: false,
  });
  async function join(registration?: RegistrationRequest) {
    await edge.acceptPlatformInvitation({
      invitationId,
      ...(registration ? { registration } : {}),
    });
    await onJoined();
    navigate("/app", { replace: true });
  }
  if (invitation.isPending) return <FullPageStatus message={t("common.loading")} />;
  const errorKey =
    invitation.error instanceof ApiRequestError
      ? ((
          {
            INVITATION_EXPIRED: "invitation.errors.expired",
            INVITATION_ALREADY_USED: "invitation.errors.alreadyUsed",
            INVITATION_NOT_FOUND: "invitation.errors.notFound",
          } as Record<string, string>
        )[invitation.error.code] ?? "platformInvite.unavailable")
      : "platformInvite.unavailable";
  if (invitation.isError || !invitation.data)
    return (
      <AuthLayout>
        <p role="alert">{t(errorKey)}</p>
      </AuthLayout>
    );
  if (!existing)
    return (
      <RegistrationForm
        locale={invitation.data.locale}
        lockedRole={invitation.data.role}
        initialName={{ firstName: invitation.data.firstName, lastName: invitation.data.lastName }}
        onRegistered={() => {}}
        onSubmitRegistration={join}
      />
    );
  return (
    <AuthLayout>
      <div className="flex flex-col gap-4 rounded-xl bg-somnus-surface p-6">
        <h1 className="text-2xl font-semibold">{t("platformInvite.title")}</h1>
        <p>{t("platformInvite.existing")}</p>
        {failed ? <p role="alert">{t("platformInvite.unavailable")}</p> : null}
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailed(false);
            void join()
              .catch(() => setFailed(true))
              .finally(() => setBusy(false));
          }}
        >
          {t("platformInvite.accept")}
        </Button>
      </div>
    </AuthLayout>
  );
}
