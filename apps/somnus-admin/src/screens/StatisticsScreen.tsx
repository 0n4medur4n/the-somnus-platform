import type { Dashboards } from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * Platform statistics (Addendum A §A2.4, capability `admin_statistics_read`).
 *
 * Aggregate only, and that is a property of the data rather than a rule this
 * screen applies: the BigQuery export drops actor and subject ids before
 * anything leaves the worker, so there is no per-person number to render even if
 * someone wanted one.
 *
 * Two things this screen does that a dashboard usually does not, both for the
 * same reason — a wrong number is worse than a missing one:
 *
 * * It renders `unavailable` as a list of declared gaps. §A2.4 asks for metrics
 *   nothing currently measures (L-levels, PDF downloads, delivery outcomes,
 *   dead-letter, active members). Showing zero for those would tell an operator
 *   the platform is idle when the truth is that nobody is counting.
 * * It says so when the read was truncated, so a partial count is never read as
 *   a total.
 */
export function StatisticsScreen() {
  const { t } = useTranslation();
  const { run, busy, error } = useAdminAction();
  const [data, setData] = useState<Dashboards | null>(null);

  const load = useCallback(async () => {
    const result = await run(() => edge.statistics({}));
    if (result) setData(result);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="statistics-heading" className="flex flex-col gap-4">
      <h2 id="statistics-heading" className="text-xl font-semibold text-somnus-text">
        {t("stats.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("stats.intro")}</p>

      {error ? (
        <p role="alert" className="text-somnus-danger">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="text-sm text-somnus-subtle">
            {t("stats.rowsConsidered")}: {data.rowsConsidered}
            {data.window ? ` — ${data.window.from} → ${data.window.to}` : ""}
          </p>
          {data.truncated ? (
            <p role="status" className="text-somnus-danger">
              {t("stats.truncated")}
            </p>
          ) : null}
          {data.rowsConsidered === 0 ? (
            <p className="text-somnus-subtle">{t("stats.empty")}</p>
          ) : null}

          <Panel title={t("stats.registrations")}>
            <Numbers
              entries={Object.entries(data.funnels.registration.completed).map(
                ([branch, count]) => [branch, count] as const,
              )}
            />
          </Panel>

          <Panel title={t("stats.verification")}>
            <Numbers
              entries={[
                [t("stats.opened"), data.funnels.verification.opened],
                [t("stats.approved"), data.funnels.verification.approved],
                [t("stats.rejected"), data.funnels.verification.rejected],
                [t("stats.medianTime"), data.funnels.verification.medianTimeToDecisionMs ?? "—"],
              ]}
            />
          </Panel>

          <Panel title={t("stats.invitations")}>
            <Numbers
              entries={[
                [t("stats.issued"), data.funnels.invitation.issued],
                [t("stats.previewed"), data.funnels.invitation.previewed],
                [t("stats.accepted"), data.funnels.invitation.accepted],
                [t("stats.expired"), data.funnels.invitation.expired],
              ]}
            />
          </Panel>

          <Panel title={t("stats.counts")}>
            <Numbers entries={Object.entries(data.counts)} />
          </Panel>

          <Panel title={t("stats.breakGlass")}>
            {/* Wired now, empty until 15.5 (§A4), so the shape does not change
                when the feature lands. */}
            <p className="text-sm text-somnus-subtle">{t("stats.breakGlassPending")}</p>
            <Numbers entries={Object.entries(data.breakGlassByAdmin)} />
          </Panel>

          <Panel title={t("stats.unavailable")}>
            <p className="text-sm text-somnus-subtle">{t("stats.unavailableIntro")}</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {data.unavailable.map((gap) => (
                <li key={gap.metric}>
                  <span className="text-somnus-text">{gap.metric}</span>
                  <span className="text-somnus-subtle"> — {gap.reason}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      ) : (
        !busy && !error && <p className="text-somnus-subtle">{t("stats.empty")}</p>
      )}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `panel-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <article
      aria-labelledby={id}
      className="rounded-lg border border-somnus-border p-4 flex flex-col gap-2"
    >
      <h3 id={id} className="text-sm font-semibold text-somnus-text">
        {title}
      </h3>
      {children}
    </article>
  );
}

function Numbers({ entries }: { entries: ReadonlyArray<readonly [string, string | number]> }) {
  if (entries.length === 0) return <p className="text-sm text-somnus-subtle">0</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
      {entries.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-somnus-subtle">{label}</dt>
          <dd className="text-somnus-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
