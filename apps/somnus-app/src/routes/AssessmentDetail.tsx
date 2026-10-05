import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ResultView } from "../assessment/ResultView.js";
import { edge } from "../lib/edge.js";
import { ASSESSMENT_CONTENT_QUERY, formatDate, OWN_ASSESSMENTS_QUERY } from "./MorpheoHome.js";

/**
 * One saved result, exactly as it was frozen when it was saved (the snapshot),
 * rendered with the same approved wording as at the end of the questionnaire.
 * The snapshot route answers only to the person who saved it.
 */
export function AssessmentDetail() {
  const { t, i18n } = useTranslation();
  const { sessionId = "" } = useParams();
  const snapshot = useQuery({
    queryKey: ["assessment-snapshot", sessionId],
    queryFn: () => edge.getAssessmentSnapshot(sessionId),
    enabled: sessionId.length > 0,
  });
  const content = useQuery({
    queryKey: ASSESSMENT_CONTENT_QUERY,
    queryFn: edge.getAssessmentContent,
  });
  const own = useQuery({ queryKey: OWN_ASSESSMENTS_QUERY, queryFn: edge.getOwnAssessments });
  const savedAt = own.data?.assessments.find((item) => item.sessionId === sessionId)?.createdAt;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/app"
          className="font-medium text-somnus-primary underline-offset-4 hover:underline"
        >
          ← {t("resultPage.back")}
        </Link>
        <h1 className="text-2xl font-semibold">{t("resultPage.title")}</h1>
        {savedAt ? (
          <p className="text-somnus-subtle">
            {t("resultPage.savedOn", {
              date: formatDate(savedAt, i18n.resolvedLanguage ?? "es", true),
            })}
          </p>
        ) : null}
      </div>
      {snapshot.isPending || content.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : snapshot.isError || content.isError ? (
        <p role="alert" className="text-somnus-danger">
          {t("resultPage.error")}
        </p>
      ) : (
        <ResultView result={snapshot.data.result} content={content.data} complaints={[]} />
      )}
    </div>
  );
}
