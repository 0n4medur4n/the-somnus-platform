import type { AdminCapability, AdminMeResponse } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import { Button } from "../components/Button.js";
import { ConsoleLayout } from "../layouts/ConsoleLayout.js";
import { DeletionRequestsScreen } from "../screens/DeletionRequestsScreen.js";
import { OrganizationsScreen } from "../screens/OrganizationsScreen.js";
import { RolesScreen } from "../screens/RolesScreen.js";
import { UsersScreen } from "../screens/UsersScreen.js";
import { VerificationScreen } from "../screens/VerificationScreen.js";

type ViewId = "overview" | "users" | "deletions" | "organizations" | "verification" | "roles";

/**
 * Which capability each section needs. Transcribed from Addendum A §A2.2, and
 * the ONLY thing that decides whether a section is offered -- the console has no
 * role logic of its own, and `capabilities` is a decision identity made.
 *
 * A section that is not offered is also not reachable: there is no URL for it.
 * The server would refuse the call anyway; not rendering the control means an
 * admin is never invited into a 403.
 */
const VIEW_CAPABILITY: Record<Exclude<ViewId, "overview">, AdminCapability> = {
  users: "admin_users_read",
  deletions: "admin_deletion_requests_process",
  organizations: "admin_organizations_manage",
  verification: "admin_verification_queue",
  roles: "admin_roles_assign",
};

export function ConsoleHome({ me }: { me: AdminMeResponse }) {
  const { t } = useTranslation();
  const { logout } = useAdminAuth();
  const [view, setView] = useState<ViewId>("overview");

  const held = new Set(me.capabilities);
  const available: ViewId[] = [
    "overview",
    ...(Object.keys(VIEW_CAPABILITY) as Array<Exclude<ViewId, "overview">>).filter((id) =>
      held.has(VIEW_CAPABILITY[id]),
    ),
  ];

  return (
    <ConsoleLayout>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-somnus-text">{t("console.title")}</h1>
          <p className="text-somnus-subtle">{t("console.signedInAs", { email: me.user.email })}</p>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          {t("common.signOut")}
        </Button>
      </div>

      <nav aria-label={t("console.title")}>
        <ul className="flex flex-wrap gap-2">
          {available.map((id) => (
            <li key={id}>
              <Button
                variant={view === id ? "primary" : "secondary"}
                type="button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => setView(id)}
              >
                {t(`nav.${id}`)}
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {view === "overview" ? <Overview me={me} /> : null}
      {view === "users" ? (
        <UsersScreen canChangeStatus={held.has("admin_account_status_write")} />
      ) : null}
      {view === "deletions" ? <DeletionRequestsScreen /> : null}
      {view === "organizations" ? <OrganizationsScreen /> : null}
      {view === "verification" ? <VerificationScreen /> : null}
      {view === "roles" ? <RolesScreen actingAdminUserId={me.user.id} /> : null}
    </ConsoleLayout>
  );
}

function Overview({ me }: { me: AdminMeResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <section aria-labelledby="roles-heading" className="flex flex-col gap-2">
        <h2 id="roles-heading" className="text-lg font-medium text-somnus-text">
          {t("console.rolesTitle")}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {me.roleKeys.map((role) => (
            <li
              key={role}
              className="rounded-full border border-somnus-subtle/25 px-3 py-1 text-sm text-somnus-text"
            >
              {t(`role.${role}`)}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="capabilities-heading" className="flex flex-col gap-2">
        <h2 id="capabilities-heading" className="text-lg font-medium text-somnus-text">
          {t("console.capabilitiesTitle")}
        </h2>
        {me.capabilities.length === 0 ? (
          <p className="text-somnus-subtle">{t("console.noCapabilities")}</p>
        ) : (
          <ul data-testid="capability-list" className="flex flex-col gap-2">
            {me.capabilities.map((capability) => (
              <li
                key={capability}
                className="rounded-lg border border-somnus-subtle/15 bg-somnus-surface px-3 py-2 text-somnus-text"
              >
                {t(`capability.${capability}`)}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-somnus-subtle">{t("console.pendingNotice")}</p>
      </section>
    </>
  );
}
