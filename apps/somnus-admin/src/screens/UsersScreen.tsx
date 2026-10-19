import type { AdminUserDetail, AdminUserSummary } from "@somnus/api-contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { PlatformInvitations } from "./PlatformInvitations.js";
import { StaffInvitations } from "./StaffInvitations.js";
import { UserMetadata } from "./UserMetadata.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * User search and detail (Addendum A Checkpoint 15.2, capabilities
 * `admin_users_read` and `admin_account_status_write`).
 *
 * §A2.3: administrative access is not clinical access. This screen shows who
 * someone is and what state their account is in. It shows no assessment, no
 * answer, no report -- reaching those is break-glass, a different capability
 * with a justification, in Checkpoint 15.5. The screen says so, so nobody
 * assumes the absence is an oversight.
 *
 * The suspend control only appears when the server said this admin holds
 * `admin_account_status_write`: the console renders from the decision.
 */
export function UsersScreen({
  canChangeStatus,
  canInvite = false,
  canInviteMorpheo = false,
}: {
  canChangeStatus: boolean;
  /** `admin_roles_assign`: may invite staff (owner decision 2026-10-18). */
  canInvite?: boolean;
  canInviteMorpheo?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const { run, busy, error, notice } = useAdminAction();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [reason, setReason] = useState("");

  async function search() {
    const trimmed = query.trim();
    const response = await run(() =>
      edge.searchUsers({ ...(trimmed ? { email: trimmed } : {}), limit: 100 }),
    );
    if (response) {
      setResults(response.users);
      setTruncated(response.truncated);
      setDetail(null);
    }
  }

  // The screen opens on the accounts themselves, not on an empty search box.
  useEffect(() => {
    void search();
  }, []);

  async function open(userId: string) {
    const found = await run(() => edge.userDetail(userId));
    if (found) {
      setDetail(found);
      setReason("");
    }
  }

  async function setStatus(status: "active" | "suspended") {
    if (!detail || reason.trim().length < 3) return;
    const done = await run(
      () => edge.setUserStatus(detail.user.id, { status, reason: reason.trim() }),
      "users.statusChanged",
    );
    if (done !== null) await open(detail.user.id);
  }

  return (
    <section aria-labelledby="users-heading" className="flex flex-col gap-4">
      <h2 id="users-heading" className="text-xl font-semibold text-somnus-text">
        {t("users.title")}
      </h2>

      {canInviteMorpheo ? <PlatformInvitations /> : null}
      {canInvite ? <StaffInvitations /> : null}

      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="flex-1">
          <Field
            id="user-search"
            label={t("users.searchLabel")}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {t("users.searchCta")}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-somnus-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className="text-somnus-success">
          {notice}
        </p>
      ) : null}
      {truncated ? <p className="text-sm text-somnus-subtle">{t("users.truncated")}</p> : null}

      {results && results.length === 0 ? (
        <p className="text-somnus-subtle">{t("users.empty")}</p>
      ) : null}

      {results && results.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table data-testid="user-results" className="w-full text-left text-sm">
            <caption className="sr-only">{t("users.title")}</caption>
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-somnus-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("users.colEmail")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("users.colStatus")}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  {t("users.colCreated")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">{t("users.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {results.map((user) => (
                <tr
                  key={user.id}
                  className={detail?.user.id === user.id ? "bg-somnus-primary/10" : undefined}
                >
                  <td className="max-w-[16rem] truncate px-4 py-3 text-somnus-text">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.status === "active"
                          ? "bg-somnus-success/15 text-somnus-success"
                          : user.status === "suspended"
                            ? "bg-somnus-danger/15 text-somnus-danger"
                            : "bg-white/10 text-somnus-subtle"
                      }`}
                    >
                      {t(`status.${user.status}`)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-somnus-subtle tabular-nums sm:table-cell">
                    {date.format(new Date(user.createdAt))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" type="button" onClick={() => void open(user.id)}>
                      {t("users.view")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <div
          data-testid="user-detail"
          className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/15 bg-somnus-surface p-4"
        >
          <h3 className="text-lg font-medium text-somnus-text">{t("users.detailTitle")}</h3>
          <p className="text-sm text-somnus-subtle">{t("users.noClinical")}</p>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-somnus-subtle">{t("users.colEmail")}</dt>
            <dd className="text-somnus-text">{detail.user.email}</dd>
            <dt className="text-somnus-subtle">{t("users.colStatus")}</dt>
            <dd className="text-somnus-text">{t(`status.${detail.user.status}`)}</dd>
            <dt className="text-somnus-subtle">{t("users.internalRoles")}</dt>
            <dd className="text-somnus-text">
              {detail.internalRoles.length > 0
                ? detail.internalRoles.map((role) => t(`role.${role}`)).join(", ")
                : t("users.none")}
            </dd>
            <dt className="text-somnus-subtle">{t("users.organizations")}</dt>
            <dd className="text-somnus-text">
              {detail.organizationIds.length > 0
                ? String(detail.organizationIds.length)
                : t("users.none")}
            </dd>
            <dt className="text-somnus-subtle">{t("users.professional")}</dt>
            <dd className="text-somnus-text">
              {detail.professionalProfile
                ? `${t(`specialty.${detail.professionalProfile.specialty}`)} · ${t(`metadata.verification.${detail.professionalProfile.verificationStatus}`)}`
                : t("users.none")}
            </dd>
          </dl>

          <UserMetadata detail={detail} />

          {canChangeStatus && detail.user.status !== "deleted" ? (
            <div className="flex flex-col gap-3 border-t border-somnus-subtle/15 pt-3">
              <Field
                id="status-reason"
                label={t("users.reasonLabel")}
                hint={t("users.reasonHint")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                type="button"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  void setStatus(detail.user.status === "active" ? "suspended" : "active")
                }
              >
                {detail.user.status === "active" ? t("users.suspend") : t("users.reactivate")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
