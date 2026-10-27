import type { FunnelReport } from "@somnus/api-contracts";
import { useTranslation } from "react-i18next";

/** The professional's page of the PDF, on screen: the same rows, in the same words. */
export function ProfessionalSummary({ report }: { report: FunnelReport }) {
  const { t } = useTranslation();
  const pro = report.professional;
  if (!pro) return null;
  const none = t("funnel.report.proNone");
  const origin = {
    answered: null,
    narrative: t("funnel.report.proOriginNarrative"),
    corrected: t("funnel.report.proOriginCorrected"),
  } as const;
  const when = {
    end: null,
    moment: t("funnel.report.proWhenMoment"),
    confirmed: t("funnel.report.proWhenConfirmed"),
  } as const;
  const flags = pro.flags.map((flag) =>
    flag.reasons.length > 0 ? `${flag.id}: ${flag.reasons.join(", ")}` : flag.id,
  );
  const engine: Array<[string, string]> = [
    [t("funnel.report.proMainAction"), pro.mainAction ?? none],
    [t("funnel.report.proAssociated"), pro.associatedActions.join(" · ") || none],
    [t("funnel.report.proTemplates"), pro.templates.join(" · ")],
    [t("funnel.report.proRules"), pro.rules.join("\n") || none],
    [t("funnel.report.proFlags"), flags.join("\n") || none],
    [t("funnel.report.proAlerts"), pro.alerts.join(" · ") || none],
    [t("funnel.report.proPending"), pro.pendingData.join(" · ") || none],
  ];
  return (
    <details
      open
      className="flex flex-col gap-3 rounded-xl border border-somnus-muted/30 p-4"
      data-testid="funnel-report-professional"
    >
      <summary className="cursor-pointer font-semibold">{t("funnel.report.proTitle")}</summary>
      <h4 className="mt-3 font-semibold">{t("funnel.report.proEngine")}</h4>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        {engine.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-somnus-subtle">{label}</dt>
            <dd className="whitespace-pre-line">{value}</dd>
          </div>
        ))}
      </dl>
      {pro.safety.length > 0 ? (
        <>
          <h4 className="mt-3 font-semibold">{t("funnel.report.proSafety")}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {pro.safety.map((row) => (
              <li key={`${row.question}-${row.when}`}>
                <span className="text-somnus-subtle">{row.question}</span>{" "}
                <strong>{row.answer}</strong>
                {when[row.when] ? <em className="ml-1 text-xs">({when[row.when]})</em> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4 className="mt-3 font-semibold">{t("funnel.report.proAnswers")}</h4>
      <ul className="flex flex-col gap-1 text-sm">
        {pro.answers
          .filter((row) => row.id !== "Q01")
          .map((row) => (
            <li key={row.id}>
              <span className="text-somnus-subtle">{row.question}</span>{" "}
              <strong>{row.answer}</strong>
              {origin[row.origin] ? <em className="ml-1 text-xs">({origin[row.origin]})</em> : null}
            </li>
          ))}
      </ul>
      <p className="text-xs text-somnus-subtle">{t("funnel.report.proOriginNote")}</p>
      {pro.narrative ? (
        <>
          <h4 className="mt-3 font-semibold">{t("funnel.report.proNarrative")}</h4>
          <p className="text-sm italic">«{pro.narrative}»</p>
        </>
      ) : null}
      {report.sources.length > 0 ? (
        <>
          <h4 className="mt-3 font-semibold">{t("funnel.report.proSources")}</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-somnus-subtle">
            {report.sources.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="text-xs text-somnus-subtle">{t("funnel.report.proUnknown")}</p>
    </details>
  );
}
