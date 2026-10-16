import { useTranslation } from "react-i18next";
import { activeLocale } from "../i18n/index.js";
import { edge } from "../lib/edge.js";

/**
 * "Descargar informe": the report for one saved assessment, as a PDF, in the
 * language the person is reading. A plain download link: edge-api builds the
 * report from the frozen result of THIS person's assessment, so there is
 * nothing to send and nothing that could change what it says.
 */
export function DownloadReportLink({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={edge.assessmentReportUrl(sessionId, activeLocale())}
      download
      className="inline-flex items-center justify-center rounded-md border border-somnus-subtle/50 px-4 py-2 font-medium text-somnus-text hover:bg-somnus-surface"
    >
      {t("report.download")}
    </a>
  );
}
