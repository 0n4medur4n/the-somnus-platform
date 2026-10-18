import type { AdminMeResponse } from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BarChart, HBarChart } from "../components/charts/charts.js";
import { Icon } from "../components/ui/Icon.js";
import { Card, SectionTitle, StatTile } from "../components/ui/ui.js";
import { edge } from "../lib/edge.js";
import { usePendingCounts, type ViewId } from "../routes/sections.js";

/**
 * The console's home: what needs attention, how many accounts there are and
 * how they arrived, and what the platform did. Every block is gated on the
 * capability its data needs, so the dashboard never shows a figure the server
 * would refuse -- and a block whose data does not exist yet says so rather
 * than showing a zero that would read as "nothing happened".
 */
export function DashboardScreen({
  me,
  onNavigate,
}: {
  me: AdminMeResponse;
  onNavigate: (view: ViewId) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const held = new Set(me.capabilities);
  const pending = usePendingCounts(held);

  const overview = useQuery({
    queryKey: ["dashboard", "usersOverview"],
    queryFn: () => edge.usersOverview(),
    enabled: held.has("admin_users_read"),
  });
  const organizations = useQuery({
    queryKey: ["dashboard", "organizations"],
    queryFn: () => edge.organizations(),
    enabled: held.has("admin_organizations_manage"),
  });
  const stats = useQuery({
    queryKey: ["dashboard", "statistics"],
    queryFn: () => edge.statistics(),
    enabled: held.has("admin_statistics_read"),
  });

  const number = new Intl.NumberFormat(i18n.language);
  const shortDate = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
  const longDate = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const queues = [
    held.has("admin_deletion_requests_process")
      ? {
          view: "deletions" as const,
          icon: "userX" as const,
          label: t("dashboard.pendingDeletions"),
          value: pending.deletions,
        }
      : null,
    held.has("admin_verification_queue")
      ? {
          view: "verification" as const,
          icon: "verify" as const,
          label: t("dashboard.pendingVerifications"),
          value: pending.verification,
        }
      : null,
    held.has("admin_content_review")
      ? {
          view: "contentReview" as const,
          icon: "sparkles" as const,
          label: t("dashboard.pendingReviews"),
          value: pending.contentReview,
        }
      : null,
  ].filter((q) => q !== null);

  const o = overview.data;
  const orgs = organizations.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-somnus-subtle">
          {t("dashboard.welcome", { email: me.user.email })} · {longDate.format(new Date())}
        </p>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
        >
          <Icon name="refresh" className="h-4 w-4" />
          {t("dashboard.refresh")}
        </button>
      </div>

      {me.capabilities.length === 0 ? (
        <p className="text-somnus-subtle">{t("console.noCapabilities")}</p>
      ) : null}

      {held.has("admin_drive") ? (
        <Card aria-labelledby="dash-drive" className="relative overflow-hidden">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-somnus-primary/15 text-somnus-primary">
              <Icon name="drive" className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="dash-drive" className="text-lg font-semibold text-somnus-text">
                {t("dashboard.driveTitle")}
              </h2>
              <p className="flex items-center gap-1.5 text-sm text-somnus-subtle">
                <Icon name="lock" className="h-3.5 w-3.5 shrink-0" />
                {t("dashboard.driveBody")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("drive")}
              className="inline-flex items-center gap-2 rounded-lg bg-somnus-primary-strong px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              {t("dashboard.openDrive")}
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </div>
        </Card>
      ) : null}

      {queues.length > 0 ? (
        <section aria-labelledby="dash-attention">
          <SectionTitle id="dash-attention">{t("dashboard.attention")}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {queues.map((q) => (
              <StatTile
                key={q.view}
                icon={q.icon}
                label={q.label}
                value={q.value === undefined ? "—" : number.format(q.value)}
                tone={q.value ? "warning" : "success"}
                hint={q.value ? t("dashboard.review") : t("dashboard.allClear")}
                onClick={() => onNavigate(q.view)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {held.has("admin_users_read") ? (
        <section aria-labelledby="dash-accounts" className="flex flex-col gap-4">
          <SectionTitle
            id="dash-accounts"
            action={
              <button
                type="button"
                onClick={() => onNavigate("users")}
                className="inline-flex items-center gap-1 text-sm text-somnus-primary hover:underline"
              >
                {t("dashboard.viewUsers")}
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            }
          >
            {t("dashboard.accounts")}
          </SectionTitle>
          {overview.isError ? (
            <p role="alert" className="text-sm text-somnus-danger">
              {t("errors.generic")}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              icon="users"
              tone="primary"
              label={t("dashboard.totalAccounts")}
              value={o ? number.format(o.total) : "—"}
            />
            <StatTile
              icon="check"
              tone="success"
              label={t("dashboard.activeAccounts")}
              value={o ? number.format(o.byStatus.active) : "—"}
            />
            <StatTile
              icon="lock"
              tone={o?.byStatus.suspended ? "danger" : "neutral"}
              label={t("dashboard.suspendedAccounts")}
              value={o ? number.format(o.byStatus.suspended) : "—"}
            />
            <StatTile
              icon="plus"
              tone="primary"
              label={t("dashboard.newAccounts30")}
              value={o ? number.format(o.newLast30Days) : "—"}
              {...(o ? { hint: t("dashboard.newAccounts7", { count: o.newLast7Days }) } : {})}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" aria-labelledby="dash-weekly">
              <SectionTitle id="dash-weekly">{t("dashboard.signupsByWeek")}</SectionTitle>
              {o ? (
                <BarChart
                  valueLabel={t("dashboard.signups")}
                  data={o.weekly.map((w) => {
                    const date = new Date(`${w.weekStart}T00:00:00Z`);
                    return {
                      label: shortDate.format(date),
                      detail: t("dashboard.weekOf", { date: longDate.format(date) }),
                      value: w.count,
                    };
                  })}
                />
              ) : (
                <p className="text-sm text-somnus-subtle">{t("common.loading")}</p>
              )}
            </Card>
            <Card aria-labelledby="dash-types">
              <SectionTitle id="dash-types">{t("dashboard.accountTypes")}</SectionTitle>
              {o ? (
                <HBarChart
                  valueLabel={t("dashboard.accounts")}
                  data={(["adult", "parent", "professional", "unknown"] as const).map((k) => ({
                    label: t(`dashboard.type.${k}`),
                    value: o.byRegistrationRole[k],
                  }))}
                />
              ) : (
                <p className="text-sm text-somnus-subtle">{t("common.loading")}</p>
              )}
            </Card>
          </div>
        </section>
      ) : null}

      {held.has("admin_organizations_manage") ? (
        <section aria-labelledby="dash-orgs">
          <SectionTitle id="dash-orgs">{t("dashboard.organizations")}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              icon="building"
              tone="primary"
              label={t("dashboard.totalOrganizations")}
              value={orgs ? number.format(orgs.length) : "—"}
              onClick={() => onNavigate("organizations")}
            />
            <StatTile
              icon="check"
              tone="success"
              label={t("dashboard.activeOrganizations")}
              value={orgs ? number.format(orgs.filter((x) => x.status === "active").length) : "—"}
            />
            <StatTile
              icon="lock"
              label={t("dashboard.suspendedOrganizations")}
              value={
                orgs ? number.format(orgs.filter((x) => x.status === "suspended").length) : "—"
              }
            />
          </div>
        </section>
      ) : null}

      {held.has("admin_statistics_read") ? (
        <section aria-labelledby="dash-activity" className="flex flex-col gap-4">
          <SectionTitle
            id="dash-activity"
            action={
              <button
                type="button"
                onClick={() => onNavigate("statistics")}
                className="inline-flex items-center gap-1 text-sm text-somnus-primary hover:underline"
              >
                {t("dashboard.viewStatistics")}
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            }
          >
            {t("dashboard.activity")}
          </SectionTitle>
          {stats.data && stats.data.rowsConsidered === 0 ? (
            <p className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-somnus-subtle">
              <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
              {t("dashboard.noEventsYet")}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ["assessmentsStarted", "clock"],
                ["assessmentsCompleted", "check"],
                ["reportsGenerated", "file"],
                ["notificationsRequested", "share"],
              ] as const
            ).map(([key, icon]) => (
              <StatTile
                key={key}
                icon={icon}
                label={t(`dashboard.counts.${key}`)}
                value={stats.data ? number.format(stats.data.counts[key]) : "—"}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
