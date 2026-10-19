import {
  type PlatformInvitationCreateRequest,
  PlatformInvitationCreateRequestSchema,
  type SupportedLocale,
} from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";
import { Modal } from "../components/ui/ui.js";
import { edge } from "../lib/edge.js";

export function PlatformInvitations() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["users", "platformInvitations"];
  const list = useQuery({ queryKey, queryFn: () => edge.platformInvitations() });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(body: PlatformInvitationCreateRequest) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { firstName, lastName, email, role, locale } = body;
      const result = await edge.invitePlatformUser({ firstName, lastName, email, role, locale });
      setNotice(t(result.emailQueued ? "platformInvite.queued" : "platformInvite.notQueued"));
      await queryClient.invalidateQueries({ queryKey });
      setOpen(false);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await edge.revokePlatformInvitation(id);
      await queryClient.invalidateQueries({ queryKey });
      setNotice(t("platformInvite.revoked"));
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-labelledby="platform-invite-heading"
      className="flex flex-col gap-3 rounded-xl border border-white/10 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="platform-invite-heading" className="text-lg font-semibold">
          {t("platformInvite.title")}
        </h3>
        <Button type="button" onClick={() => setOpen(true)}>
          {t("platformInvite.add")}
        </Button>
      </div>
      <p className="text-sm text-somnus-subtle">{t("platformInvite.hint")}</p>
      {notice ? <p role="status">{notice}</p> : null}
      {error || list.isError ? <p role="alert">{error || t("errors.generic")}</p> : null}
      <ul className="flex flex-col gap-2">
        {list.data?.invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3"
          >
            <span>
              {invitation.firstName} {invitation.lastName} · {invitation.email}
            </span>
            <span>
              {t(`platformInvite.role.${invitation.role}`)} ·{" "}
              {t(`staff.locale.${invitation.locale}`)} · {t(`staff.status.${invitation.status}`)}
            </span>
            <span>
              {t("platformInvite.expires", {
                date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
                  new Date(invitation.expiresAt),
                ),
              })}
            </span>
            {invitation.status === "pending" || invitation.status === "expired" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void send(invitation)}
              >
                {t("staff.resend")}
              </Button>
            ) : null}
            {invitation.status === "pending" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void revoke(invitation.id)}
              >
                {t("staff.revoke")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {list.isSuccess && list.data.invitations.length === 0 ? <p>{t("staff.empty")}</p> : null}
      {open ? <InvitationForm busy={busy} onClose={() => setOpen(false)} onSubmit={send} /> : null}
    </section>
  );
}

function InvitationForm({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: PlatformInvitationCreateRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"adult" | "professional">("adult");
  const [locale, setLocale] = useState<SupportedLocale>("es");
  const body = { firstName, lastName, email, role, locale };
  return (
    <Modal title={t("platformInvite.add")} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = PlatformInvitationCreateRequestSchema.safeParse(body);
          if (parsed.success) void onSubmit(parsed.data);
        }}
      >
        <Field
          label={t("staff.firstName")}
          value={firstName}
          required
          maxLength={120}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <Field
          label={t("staff.lastName")}
          value={lastName}
          required
          maxLength={120}
          onChange={(e) => setLastName(e.target.value)}
        />
        <Field
          label={t("users.colEmail")}
          type="email"
          value={email}
          required
          maxLength={320}
          onChange={(e) => setEmail(e.target.value)}
        />
        <SelectField
          label={t("platformInvite.type")}
          value={role}
          options={(["adult", "professional"] as const).map((value) => ({
            value,
            label: t(`platformInvite.role.${value}`),
          }))}
          onChange={(e) => setRole(e.target.value as typeof role)}
        />
        <SelectField
          label={t("staff.emailLanguage")}
          value={locale}
          options={(["es", "en", "ca", "fr"] as const).map((value) => ({
            value,
            label: t(`staff.locale.${value}`),
          }))}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        />
        <p className="text-sm text-somnus-subtle">{t("platformInvite.hint")}</p>
        <Button
          type="submit"
          disabled={busy || !PlatformInvitationCreateRequestSchema.safeParse(body).success}
        >
          {t("staff.send")}
        </Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
          {t("staff.cancel")}
        </Button>
      </form>
    </Modal>
  );
}
