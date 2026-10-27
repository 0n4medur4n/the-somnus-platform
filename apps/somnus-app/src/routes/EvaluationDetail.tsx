import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { FunnelResultView } from "../assessment/funnel/FunnelResultView.js";
import { edge } from "../lib/edge.js";
import { formatDate, OWN_FUNNEL_QUERY } from "./MorpheoHome.js";

/**
 * One of the person's own finished interviews, read back from their account: the
 * same report as at the end of the interview, with the PDF. The interview route
 * answers only to its owner (anyone else reads it as not found).
 */
export function EvaluationDetail() {
  const { t, i18n } = useTranslation();
  const { sessionId = "" } = useParams();
  const interview = useQuery({
    queryKey: ["funnel-session", sessionId],
    queryFn: () => edge.getFunnel(sessionId, false),
    enabled: sessionId.length > 0,
  });
  const own = useQuery({ queryKey: OWN_FUNNEL_QUERY, queryFn: edge.getOwnFunnelSessions });
  const savedAt = own.data?.sessions.find((item) => item.sessionId === sessionId)?.createdAt;

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
      {interview.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : interview.isError ? (
        <p role="alert" className="text-somnus-danger">
          {t("resultPage.error")}
        </p>
      ) : interview.data.result ? (
        <FunnelResultView
          result={interview.data.result}
          sessionId={sessionId}
          owned={interview.data.owned}
          signedIn
        />
      ) : (
        <p role="status">{t("resultPage.unfinished")}</p>
      )}
    </div>
  );
}
