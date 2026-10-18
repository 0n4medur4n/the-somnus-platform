import type { StaffInvitationPendingResponse } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import { Button } from "../components/Button.js";
import { ConsoleLayout } from "../layouts/ConsoleLayout.js";
import { edge } from "../lib/edge.js";

/** The marketing site's privacy policy, in the console's language. */
function privacyUrl(language: string): string {
  const locale = ["es", "en", "ca", "fr"].includes(language) ? language : "es";
  return `https://thesomnus.com/${locale}/legal/privacy/`;
}

/**
 * A signed-in person with a staff invitation waiting (owner decision
 * 2026-10-18). Their account -- and the role -- exist only once THEY accept here,
 * acknowledging the privacy policy; until then this is the whole console for
 * them, exactly like the denial screen.
 */
export function Invited({
  invitation,
}: {
  invitation: NonNullable<StaffInvitationPendingResponse["invitation"]>;
}) {
  const { t, i18n } = useTranslation();
  const { refresh, logout } = useAdminAuth();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const expires = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(
    new Date(invitation.expiresAt),
  );

  async function accept() {
    setBusy(true);
    setFailed(false);
    try {
      await edge.acceptStaffInvitation();
      await refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <ConsoleLayout>
      <div className="rounded-2xl border border-somnus-primary/30 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        <h1 className="text-2xl font-semibold text-somnus-text">
          {t("invited.title", { name: invitation.firstName })}
        </h1>
        <p className="mt-3 text-somnus-text">
          {t("invited.body", { role: t(`role.${invitation.roleKey}`) })}
        </p>
        <p className="mt-2 text-sm text-somnus-subtle">{t("invited.expires", { date: expires })}</p>

        <label className="mt-6 flex items-start gap-3 text-sm text-somnus-text">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-somnus-primary"
          />
          <span>
            {t("invited.privacy")}{" "}
            <a
              href={privacyUrl(i18n.language)}
              target="_blank"
              rel="noreferrer"
              className="text-somnus-primary underline"
            >
              {t("invited.privacyLink")}
            </a>
          </span>
        </label>

        {failed ? (
          <p role="alert" className="mt-4 text-sm text-somnus-danger">
            {t("invited.failed")}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" disabled={!acknowledged || busy} onClick={() => void accept()}>
            {t("invited.accept")}
          </Button>
          <Button variant="secondary" type="button" onClick={() => void logout()}>
            {t("common.signOut")}
          </Button>
        </div>
      </div>
    </ConsoleLayout>
  );
}
