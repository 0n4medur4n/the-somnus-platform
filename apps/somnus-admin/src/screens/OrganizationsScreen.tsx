import type { AdminOrganizationMember, AdminOrganizationSummary } from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * Organizations (Addendum A Checkpoint 15.2, capability
 * `admin_organizations_manage`): list, create, approve/suspend, view members.
 *
 * Creating one here is §A1's platform-admin path. The admin who creates an
 * organization does NOT join it -- the screen says so after creating, because
 * an operator setting one up for a customer would reasonably expect otherwise.
 */
export function OrganizationsScreen() {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [organizations, setOrganizations] = useState<AdminOrganizationSummary[] | null>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [members, setMembers] = useState<{ id: string; rows: AdminOrganizationMember[] } | null>(
    null,
  );

  const load = useCallback(async () => {
    const list = await run(() => edge.organizations());
    if (list) setOrganizations(list);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (name.trim().length < 2) return;
    const created = await run(
      () => edge.createOrganization({ name: name.trim() }),
      "organizations.created",
    );
    if (created) {
      setName("");
      await load();
    }
  }

  async function setStatus(organizationId: string, status: "active" | "suspended") {
    if (reason.trim().length < 3) return;
    const updated = await run(
      () => edge.setOrganizationStatus(organizationId, { status, reason: reason.trim() }),
      "organizations.statusChanged",
    );
    if (updated) {
      setReason("");
      await load();
    }
  }

  async function openMembers(organizationId: string) {
    const rows = await run(() => edge.organizationMembers(organizationId));
    if (rows) setMembers({ id: organizationId, rows });
  }

  return (
    <section aria-labelledby="organizations-heading" className="flex flex-col gap-4">
      <h2 id="organizations-heading" className="text-xl font-semibold text-somnus-text">
        {t("organizations.title")}
      </h2>

      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="flex-1">
          <Field
            id="organization-name"
            label={t("organizations.nameLabel")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || name.trim().length < 2}>
          {t("organizations.create")}
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

      <Field
        id="organization-reason"
        label={t("users.reasonLabel")}
        hint={t("users.reasonHint")}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      {organizations && organizations.length === 0 ? (
        <p className="text-somnus-subtle">{t("organizations.empty")}</p>
      ) : null}

      {organizations && organizations.length > 0 ? (
        <ul data-testid="organization-list" className="flex flex-col gap-2">
          {organizations.map((organization) => (
            <li
              key={organization.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-somnus-subtle/15 bg-somnus-surface px-3 py-2"
            >
              <span className="flex-1 text-somnus-text">{organization.name}</span>
              <span className="text-sm text-somnus-subtle">
                {t(`status.${organization.status}`)}
              </span>
              <Button
                variant="secondary"
                type="button"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  void setStatus(
                    organization.id,
                    organization.status === "active" ? "suspended" : "active",
                  )
                }
              >
                {organization.status === "active"
                  ? t("organizations.suspend")
                  : t("organizations.approve")}
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => void openMembers(organization.id)}
              >
                {t("organizations.members")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {members ? (
        <div
          data-testid="organization-members"
          className="rounded-lg border border-somnus-subtle/15 bg-somnus-surface p-4"
        >
          <h3 className="text-lg font-medium text-somnus-text">
            {t("organizations.membersTitle")}
          </h3>
          {members.rows.length === 0 ? (
            <p className="text-somnus-subtle">{t("organizations.noMembers")}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 font-mono text-sm text-somnus-text">
              {members.rows.map((member) => (
                <li key={member.membershipId}>
                  {member.userId} · {member.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
