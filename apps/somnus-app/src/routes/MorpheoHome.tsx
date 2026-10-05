import type { AssessmentContentResponse, MeResponse, OwnAssessment } from "@somnus/api-contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";
import { type AccountView, accountViewOf } from "../auth/account-view.js";
import { useAuth } from "../auth/useAuth.js";
import { Avatar } from "../components/Avatar.js";
import { edge } from "../lib/edge.js";

export const OWN_ASSESSMENTS_QUERY = ["own-assessments"] as const;
export const ASSESSMENT_CONTENT_QUERY = ["assessment-content"] as const;

const actionClass =
  "inline-flex items-center justify-center rounded-md bg-somnus-primary-strong px-4 py-2 font-medium text-white hover:brightness-110";
const linkClass = "font-medium text-somnus-primary underline-offset-4 hover:underline";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-somnus-muted/30 bg-somnus-surface/60 p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function formatDate(iso: string, locale: string, withTime = false): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(new Date(iso));
}

function ProfileCard({ me, view }: { me: MeResponse; view: AccountView }) {
  const { t } = useTranslation();
  const profile = me.individualProfile;
  const incomplete = !profile?.photoUpdatedAt || !profile.dateOfBirth || !profile.phone;
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Avatar me={me} className="h-20 w-20 text-2xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-xl font-semibold">
          {profile ? `${profile.firstName} ${profile.lastName}` : me.user.email}
        </p>
        <p className="break-words text-somnus-subtle">{me.user.email}</p>
        <p>
          <span className="rounded-full border border-somnus-muted/40 px-3 py-0.5 text-sm text-somnus-subtle">
            {t(`space.accountType.${view.kind}`)}
          </span>
        </p>
        {incomplete ? (
          <p className="text-sm text-somnus-subtle">{t("space.completeProfile")}</p>
        ) : null}
      </div>
      <Link to="/app/profile" className={linkClass}>
        {incomplete ? t("space.completeProfileLink") : t("space.editProfile")}
      </Link>
    </Card>
  );
}

function Stats({ assessments, locale }: { assessments: OwnAssessment[]; locale: string }) {
  const { t } = useTranslation();
  // Newest first, as morpheo returns them.
  const latest = assessments[0];
  const first = assessments[assessments.length - 1];
  if (!latest || !first) return null;
  const stats = [
    { label: t("space.stats.first"), value: formatDate(first.createdAt, locale) },
    { label: t("space.stats.last"), value: formatDate(latest.createdAt, locale) },
    { label: t("space.stats.count"), value: String(assessments.length) },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <Card key={stat.label} className="flex flex-col gap-1">
          <dt className="text-sm text-somnus-subtle">{stat.label}</dt>
          <dd className="text-lg font-semibold">{stat.value}</dd>
        </Card>
      ))}
    </dl>
  );
}

function History({
  assessments,
  content,
  locale,
}: {
  assessments: OwnAssessment[];
  content: AssessmentContentResponse | undefined;
  locale: string;
}) {
  const { t } = useTranslation();
  const levelName = (level: OwnAssessment["level"]) =>
    level ? content?.safetyLevels.find((safety) => safety.id === level)?.name : undefined;

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-3">
      <h2 id="history-heading" className="text-lg font-semibold">
        {t("space.history.title")}
      </h2>
      <ul className="flex flex-col gap-3">
        {assessments.map((assessment) => {
          const date = formatDate(assessment.createdAt, locale, true);
          const name = levelName(assessment.level);
          return (
            <li key={assessment.sessionId}>
              <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{date}</p>
                  <p className="text-sm text-somnus-subtle">
                    {t(
                      assessment.role === "parent"
                        ? "space.history.forMinor"
                        : "space.history.forSelf",
                    )}
                  </p>
                  {name ? (
                    <p className="text-sm">
                      <span className="text-somnus-subtle">{t("space.history.level")}: </span>
                      {name}
                    </p>
                  ) : null}
                </div>
                <Link
                  to={`/app/assessments/${encodeURIComponent(assessment.sessionId)}`}
                  className={linkClass}
                  aria-label={t("space.history.viewNamed", { date })}
                >
                  {t("space.history.view")}
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A Morpheo user's own space, after their first assessment: who they are,
 * when they first assessed their sleep, every saved result, and a new
 * assessment one click away. Someone with no saved assessment yet is sent to
 * the questionnaire instead -- that is where a Morpheo user always starts.
 */
export function MorpheoHome() {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  const own = useQuery({ queryKey: OWN_ASSESSMENTS_QUERY, queryFn: edge.getOwnAssessments });
  const content = useQuery({
    queryKey: ASSESSMENT_CONTENT_QUERY,
    queryFn: edge.getAssessmentContent,
  });

  if (state.status !== "authenticated") return null;
  const { me } = state;
  const view = accountViewOf(me);
  const locale = i18n.resolvedLanguage ?? "es";
  const firstName = me.individualProfile?.firstName;

  if (own.isPending) {
    return <p role="status">{t("space.loading")}</p>;
  }
  if (own.isError) {
    return (
      <p role="alert" className="text-somnus-danger">
        {t("space.error")}
      </p>
    );
  }
  if (own.data.assessments.length === 0) {
    // An empty list may be the stale one cached before the first result was
    // saved; redirecting on it would bounce the person straight back to the
    // questionnaire. Only a fresh empty answer sends them there.
    if (own.isFetching) return <p role="status">{t("space.loading")}</p>;
    return <Navigate to="/assessment" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="home-heading" className="text-2xl font-semibold">
          {t("space.title")}
        </h1>
        <p className="text-lg">
          {firstName ? t("space.greeting", { name: firstName }) : t("space.greetingNoName")}
        </p>
      </div>

      <ProfileCard me={me} view={view} />
      <Stats assessments={own.data.assessments} locale={locale} />

      <Card className="flex flex-col gap-3 border-somnus-primary/50 bg-somnus-primary/10">
        <h2 className="text-lg font-semibold">{t("space.newAssessment.title")}</h2>
        <p className="text-somnus-subtle">
          {t(
            view.kind === "parent" ? "space.newAssessment.bodyParent" : "space.newAssessment.body",
          )}
        </p>
        <div>
          <Link to="/assessment" className={actionClass}>
            {t("space.newAssessment.start")}
          </Link>
        </div>
      </Card>

      <History assessments={own.data.assessments} content={content.data} locale={locale} />
    </div>
  );
}
