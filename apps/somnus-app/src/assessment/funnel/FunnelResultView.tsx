import type { FunnelResult } from "@somnus/api-contracts";
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
      {result.instruments.length > 0 ? (
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
