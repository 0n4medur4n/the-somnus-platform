import type { AdminMeResponse } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import type { IconName } from "../components/ui/Icon.js";
import { Card } from "../components/ui/ui.js";
import { DriveScreen } from "../drive/ui/DriveScreen.js";
import { AppShell, type NavGroup } from "../layouts/AppShell.js";
import { AuditViewerScreen } from "../screens/AuditViewerScreen.js";
import { BreakGlassScreen } from "../screens/BreakGlassScreen.js";
import { ContentReviewScreen } from "../screens/ContentReviewScreen.js";
import { CorpusScreen } from "../screens/CorpusScreen.js";
import { CorpusSourcesScreen } from "../screens/CorpusSourcesScreen.js";
import { DashboardScreen } from "../screens/DashboardScreen.js";
import { DeletionRequestsScreen } from "../screens/DeletionRequestsScreen.js";
import { OrganizationsScreen } from "../screens/OrganizationsScreen.js";
import { RolesScreen } from "../screens/RolesScreen.js";
import { StatisticsScreen } from "../screens/StatisticsScreen.js";
import { UsersScreen } from "../screens/UsersScreen.js";
import { VerificationScreen } from "../screens/VerificationScreen.js";
import { GROUPS, usePendingCounts, type ViewId } from "./sections.js";

export function ConsoleHome({ me }: { me: AdminMeResponse }) {
  const { t } = useTranslation();
  const { logout } = useAdminAuth();
  const [view, setView] = useState<ViewId>("overview");

  const held = new Set(me.capabilities);
  const pending = usePendingCounts(held);
  const counts: Partial<Record<ViewId, number | undefined>> = {
    deletions: pending.deletions,
    verification: pending.verification,
    contentReview: pending.contentReview,
  };

  const groups: NavGroup<ViewId>[] = [
    {
      label: t("navGroup.general"),
      items: [
        { id: "overview" as ViewId, label: t("nav.overview"), icon: "dashboard" as IconName },
      ],
    },
    ...GROUPS.map((group) => ({
      label: t(`navGroup.${group.key}`),
      items: group.sections
        .filter((s) => held.has(s.capability))
        .map((s) => {
          const count = counts[s.id];
          return {
            id: s.id as ViewId,
            label: t(`nav.${s.id}`),
            icon: s.icon,
            ...(count ? { count } : {}),
          };
        }),
    })),
  ].filter((group) => group.items.length > 0);

  const sectionOf = groups.find((g) => g.items.some((i) => i.id === view))?.label;

  return (
    <AppShell
      groups={groups}
      active={view}
      onNavigate={setView}
      email={me.user.email}
      roles={me.roleKeys.map((role) => t(`role.${role}`))}
      onSignOut={() => void logout()}
      title={view === "overview" ? t("console.title") : t(`nav.${view}`)}
      titleIsHeading={view === "overview" || view === "drive"}
      {...(sectionOf ? { section: sectionOf } : {})}
    >
      {view === "overview" ? (
        <DashboardScreen me={me} onNavigate={(id) => setView(id)} />
      ) : view === "drive" ? (
        // The Drive is a full-width tool, not a card. Unmounting it drops its keys.
        <DriveScreen />
      ) : (
        <Card>
          {view === "users" ? (
            <UsersScreen canChangeStatus={held.has("admin_account_status_write")} />
          ) : null}
          {view === "deletions" ? <DeletionRequestsScreen /> : null}
          {view === "organizations" ? <OrganizationsScreen /> : null}
          {view === "verification" ? <VerificationScreen /> : null}
          {view === "contentReview" ? <ContentReviewScreen /> : null}
          {view === "statistics" ? <StatisticsScreen /> : null}
          {/* The CSV export is its own capability (super admin only, §A4). */}
          {view === "audit" ? (
            <AuditViewerScreen canExport={held.has("admin_audit_export")} />
          ) : null}
          {view === "breakGlass" ? <BreakGlassScreen /> : null}
          {/* §B3: draft, publish, retire. No delete control exists on either. */}
          {view === "corpus" ? <CorpusScreen /> : null}
          {view === "corpusSources" ? <CorpusSourcesScreen /> : null}
          {view === "roles" ? <RolesScreen actingAdminUserId={me.user.id} /> : null}
        </Card>
      )}
    </AppShell>
  );
}
