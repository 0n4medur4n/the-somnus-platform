import {
  STAFF_INVITATION_ROLE_KEYS,
  type StaffInvitation,
  type StaffInvitationCreateRequest,
  type StaffInvitationRoleKey,
  type SupportedLocale,
} from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";
import { Icon } from "../components/ui/Icon.js";
import { Modal } from "../components/ui/ui.js";
import { edge } from "../lib/edge.js";

const LOCALES: SupportedLocale[] = ["es", "en", "ca", "fr"];
const QUERY_KEY = ["users", "staffInvitations"];

type Notice = { tone: "success" | "warning" | "danger"; text: string } | null;

const STATUS_STYLE: Record<StaffInvitation["status"], string> = {
  pending: "bg-somnus-primary/15 text-somnus-primary",
  accepted: "bg-somnus-success/15 text-somnus-success",
  revoked: "bg-white/10 text-somnus-subtle",
  expired: "bg-white/10 text-somnus-subtle",
};

/**
 * "Add a person" for the staff (owner decision 2026-10-18): the admin writes
 * down who and with which internal role, and the person receives an email to
 * sign in and accept. Nobody gets an account they did not accept themselves.
 * Rendered only for holders of `admin_roles_assign`.
 */
export function StaffInvitations() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: () => edge.staffInvitations() });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  async function send(body: StaffInvitationCreateRequest): Promise<boolean> {
    try {
      const result = await edge.inviteStaff(body);
      setNotice(
        result.emailSent
          ? { tone: "success", text: t("staff.sent", { email: result.invitation.email }) }
          : { tone: "warning", text: t("staff.savedNotSent", { email: result.invitation.email }) },
      );
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      return true;
    } catch {
      setNotice({ tone: "danger", text: t("staff.failed") });
      return false;
    }
  }

  async function resend(invitation: StaffInvitation) {
    setBusyId(invitation.id);
    await send({
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      email: invitation.email,
      roleKey: invitation.roleKey,
      locale: invitation.locale,
    });
    setBusyId(null);
  }

  async function revoke(invitation: StaffInvitation) {
    setBusyId(invitation.id);
    try {
      await edge.revokeStaffInvitation(invitation.id);
      setNotice({ tone: "success", text: t("staff.revoked", { email: invitation.email }) });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch {
      setNotice({ tone: "danger", text: t("staff.failed") });
    }
    setBusyId(null);
  }

  const invitations = list.data?.invitations ?? [];

  return (
    <section aria-labelledby="staff-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="staff-heading" className="text-lg font-semibold text-somnus-text">
            {t("staff.title")}
          </h3>
          <p className="text-sm text-somnus-subtle">{t("staff.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-somnus-primary-strong px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          <Icon name="plus" className="h-4 w-4" />
          {t("staff.add")}
        </button>
      </div>

      {notice ? (
        <p
          role={notice.tone === "danger" ? "alert" : "status"}
          aria-live="polite"
          className={
            notice.tone === "success"
              ? "text-sm text-somnus-success"
              : notice.tone === "warning"
                ? "text-sm text-amber-300"
                : "text-sm text-somnus-danger"
          }
        >
          {notice.text}
        </p>
      ) : null}

      {list.isError ? (
        <p role="alert" className="text-sm text-somnus-danger">
          {t("errors.generic")}
        </p>
      ) : null}

      {invitations.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table data-testid="staff-invitations" className="w-full text-left text-sm">
            <caption className="sr-only">{t("staff.title")}</caption>
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-somnus-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("staff.colName")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("users.colEmail")}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  {t("staff.colRole")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("users.colStatus")}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  {t("staff.colDate")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">{t("users.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td className="px-4 py-3 text-somnus-text">
                    {invitation.firstName} {invitation.lastName}
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-3 text-somnus-subtle">
                    {invitation.email}
                  </td>
                  <td className="hidden px-4 py-3 text-somnus-subtle md:table-cell">
                    {t(`role.${invitation.roleKey}`)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[invitation.status]}`}
                    >
                      {t(`staff.status.${invitation.status}`)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums text-somnus-subtle sm:table-cell">
                    {date.format(
                      new Date(
                        invitation.status === "accepted" && invitation.acceptedAt
                          ? invitation.acceptedAt
                          : invitation.expiresAt,
                      ),
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {invitation.status === "pending" || invitation.status === "expired" ? (
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={busyId === invitation.id}
                        onClick={() => void resend(invitation)}
                      >
                        {t("staff.resend")}
                      </Button>
                    ) : null}
                    {invitation.status === "pending" ? (
                      <Button
                        variant="secondary"
                        type="button"
                        className="ml-2"
                        disabled={busyId === invitation.id}
                        onClick={() => void revoke(invitation)}
                      >
                        {t("staff.revoke")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : list.isSuccess ? (
        <p className="text-sm text-somnus-subtle">{t("staff.empty")}</p>
      ) : null}

      {open ? (
        <InviteForm
          onClose={() => setOpen(false)}
          onSubmit={async (body) => {
            if (await send(body)) setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function InviteForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (body: StaffInvitationCreateRequest) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<StaffInvitationRoleKey | "">("");
  const [locale, setLocale] = useState<SupportedLocale>(
    LOCALES.includes(i18n.language as SupportedLocale) ? (i18n.language as SupportedLocale) : "es",
  );
  const [busy, setBusy] = useState(false);
  const ready =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    roleKey !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    await onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      roleKey,
      locale,
    });
    setBusy(false);
  }

  return (
    <Modal title={t("staff.formTitle")} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-somnus-subtle">{t("staff.formHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("staff.firstName")}
            value={firstName}
            autoComplete="off"
            maxLength={120}
            required
            onChange={(event) => setFirstName(event.target.value)}
          />
          <Field
            label={t("staff.lastName")}
            value={lastName}
            autoComplete="off"
            maxLength={120}
            required
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
        <Field
          label={t("users.colEmail")}
          type="email"
          value={email}
          autoComplete="off"
          maxLength={320}
          required
          onChange={(event) => setEmail(event.target.value)}
        />
        <SelectField
          label={t("staff.colRole")}
          placeholder={t("staff.chooseRole")}
          required
          options={STAFF_INVITATION_ROLE_KEYS.map((key) => ({
            value: key,
            label: t(`role.${key}`),
          }))}
          onChange={(event) => setRoleKey(event.target.value as StaffInvitationRoleKey)}
        />
        <SelectField
          label={t("staff.emailLanguage")}
          defaultValue={locale}
          options={LOCALES.map((value) => ({ value, label: t(`staff.locale.${value}`) }))}
          onChange={(event) => setLocale(event.target.value as SupportedLocale)}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("staff.cancel")}
          </Button>
          <Button type="submit" disabled={!ready || busy}>
            {t("staff.send")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
