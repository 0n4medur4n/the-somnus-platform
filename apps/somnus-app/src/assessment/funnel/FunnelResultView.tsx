import type { FunnelReport, FunnelResult } from "@somnus/api-contracts";
import { useTranslation } from "react-i18next";
import { activeLocale } from "../../i18n/index.js";
import { edge } from "../../lib/edge.js";
import { ResultPanel } from "./TeamPanel.js";

/**
 * The v2 result: morpheo's final text, paragraph by paragraph, exactly as it
 * comes -- written only from the v0.2 templates and the approved phrase
 * catalogue, never by a model -- then any completed questionnaire scores with
 * v0.2's own sentence on scales. The app adds headings only.
 */
export function FunnelResultView({
  result,
  sessionId,
  owned,
  signedIn,
}: {
  result: FunnelResult;
  sessionId: string;
  owned: boolean;
  signedIn: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="funnel-result-heading"
      data-testid="funnel-result"
      className="somnus-fade-in flex flex-col gap-5 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5 shadow-lg shadow-black/20 sm:p-7"
    >
      <h2 id="funnel-result-heading" className="text-xl font-semibold">
        {t("funnel.result.title")}
      </h2>
      {result.report?.layout === "urgent" ? (
        <UrgentReport report={result.report} texts={result.texts} />
      ) : null}
      {result.report && result.report.layout === "standard" ? (
        <StandardReport report={result.report} texts={result.texts} owned={owned} />
      ) : null}
      {result.report ? null : (
        <div
          className="flex flex-col gap-4 text-base leading-relaxed"
          data-testid="funnel-final-text"
        >
          {result.texts.map((paragraph) => (
            <p key={paragraph.template} data-template={paragraph.template}>
              {paragraph.text}
            </p>
          ))}
        </div>
      )}
      {result.instruments.length > 0 && result.report?.layout !== "urgent" ? (
        <div className="flex flex-col gap-2 border-t border-somnus-muted/30 pt-4">
          <h3 className="font-semibold">{t("funnel.result.instruments")}</h3>
          <ul className="flex flex-col gap-1">
            {result.instruments.map((instrument) => (
              <li key={instrument.code}>
                <strong>{instrument.name ?? instrument.code}</strong>:{" "}
                {t("funnel.result.points", { count: instrument.total ?? 0 })}
                {instrument.band ? ` · ${instrument.band}` : ""}
              </li>
            ))}
          </ul>
          {result.instrumentsNote ? (
            <p className="text-sm text-somnus-subtle">{result.instrumentsNote}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-somnus-muted/30 pt-4">
        {owned ? (
          <>
            <p className="text-sm text-somnus-subtle">{t("funnel.result.saved")}</p>
            <div>
              <a
                href={edge.funnelReportUrl(sessionId, activeLocale())}
                download
                className="inline-flex items-center justify-center rounded-md border border-somnus-subtle/50 px-4 py-2 font-medium text-somnus-text hover:bg-somnus-surface"
              >
                {t("funnel.result.download")}
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-somnus-subtle">
            {signedIn ? t("funnel.result.notSaved") : t("funnel.result.signInHint")}
          </p>
        )}
      </div>
      {result.panel ? <ResultPanel panel={result.panel} /> : null}
    </section>
  );
}

type Texts = FunnelResult["texts"];

function Limits({ report }: { report: FunnelReport }) {
  const { t } = useTranslation();
  return report.limits.length > 0 ? (
    <p className="border-t border-somnus-muted/30 pt-3 text-sm text-somnus-subtle">
      <strong>{t("funnel.report.limits")}.</strong> {report.limits.join(" ")}
    </p>
  ) : null;
}

/** An emergency: only the urgent message (the engine's own text) and the limits. */
function UrgentReport({ report, texts }: { report: FunnelReport; texts: Texts }) {
  return (
    <div className="flex flex-col gap-4" data-testid="funnel-report-urgent">
      <div
        className="flex flex-col gap-3 rounded-xl border-2 border-somnus-danger/70 bg-somnus-danger/10 p-4 text-base font-semibold leading-relaxed"
        data-testid="funnel-final-text"
      >
        {texts.map((paragraph) => (
          <p key={paragraph.template} data-template={paragraph.template}>
            {paragraph.text}
          </p>
        ))}
      </div>
      <Limits report={report} />
    </div>
  );
}

/** The one-page report, block by block, in the order of the PDF. */
function StandardReport({
  report,
  texts,
  owned,
}: {
  report: FunnelReport;
  texts: Texts;
  owned: boolean;
}) {
  const { t } = useTranslation();
  const summary = report.summary
    ? `${report.summary.charAt(0).toUpperCase()}${report.summary.slice(1)}`
    : null;
  const headline = [...report.headline, ...report.secondary];
  return (
    <div className="flex flex-col gap-5" data-testid="funnel-report">
      {headline.length > 0 ? (
        <section aria-labelledby="funnel-report-main" className="flex flex-col gap-2">
          <h3 id="funnel-report-main" className="font-semibold">
            {t("funnel.report.mostImportant")}
          </h3>
          <div className="flex flex-col gap-1 rounded-xl border border-somnus-primary/60 bg-somnus-primary/10 p-4 text-lg font-semibold leading-snug">
            {headline.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        </section>
      ) : null}
      {summary ? (
        <section aria-labelledby="funnel-report-told" className="flex flex-col gap-1">
          <h3 id="funnel-report-told" className="font-semibold">
            {t("funnel.report.whatYouTold")}
          </h3>
          <p>{summary}</p>
          <p className="text-sm text-somnus-subtle">{t("funnel.report.whatYouToldNote")}</p>
        </section>
      ) : null}
      <section aria-labelledby="funnel-report-means" className="flex flex-col gap-2">
        <h3 id="funnel-report-means" className="font-semibold">
          {t("funnel.report.whatItMeans")}
        </h3>
        <div
          className="flex flex-col gap-3 text-base leading-relaxed"
          data-testid="funnel-final-text"
        >
          {texts.map((paragraph) => (
            <p key={paragraph.template} data-template={paragraph.template}>
              {paragraph.text}
            </p>
          ))}
        </div>
      </section>
      {report.steps.length > 0 || owned ? (
        <section aria-labelledby="funnel-report-next" className="flex flex-col gap-1">
          <h3 id="funnel-report-next" className="font-semibold">
            {t("funnel.report.whatToDoNow")}
          </h3>
          <ul className="list-disc pl-5">
            {report.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
            {owned && report.professional ? <li>{t("funnel.report.handPage2")}</li> : null}
          </ul>
        </section>
      ) : null}
      <section
        aria-labelledby="funnel-report-help"
        className="flex flex-col gap-1 rounded-xl border-2 border-somnus-danger/60 bg-somnus-danger/10 p-4"
        data-testid="funnel-report-help"
      >
        <h3 id="funnel-report-help" className="font-semibold">
          {t("funnel.report.askForHelp")}
        </h3>
        {report.help.sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        {report.help.resources.length > 0 ? (
          <ul className="list-disc pl-5">
            {report.help.resources.map((resource) => (
              <li key={resource.code}>{resource.text}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <Limits report={report} />
    </div>
  );
}
