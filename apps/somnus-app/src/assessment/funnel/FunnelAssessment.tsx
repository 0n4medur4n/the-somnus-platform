import type { FunnelState, MeResponse, SupportedLocale } from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { accountViewOf } from "../../auth/account-view.js";
import { useAuth } from "../../auth/useAuth.js";
import { BrandLogo } from "../../components/BrandLogo.js";
import { Button } from "../../components/Button.js";
import { ChoiceCard } from "../../components/ChoiceCard.js";
import { LanguageSwitcher } from "../../components/LanguageSwitcher.js";
import { formatDateTime, LegalDocument } from "../../components/LegalDocument.js";
import { ThemeSwitcher } from "../../components/ThemeSwitcher.js";
import { activeLocale } from "../../i18n/index.js";
import { ApiRequestError } from "../../lib/api.js";
import { edge } from "../../lib/edge.js";
import { CONSENT_SOURCE, CONSENT_STATUS_QUERY, legalDocumentsQuery } from "../consent-queries.js";
import { FunnelProgress } from "./FunnelProgress.js";
import { FunnelResultView } from "./FunnelResultView.js";
import { type AnswerBody, StepView } from "./StepView.js";
import { StepPanel } from "./TeamPanel.js";

/** The interview in progress, so a reload resumes it (per tab; only its id). */
const STORAGE_KEY = "somnus.funnel.session";

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(sessionId: string | null): void {
  try {
    if (sessionId) window.sessionStorage.setItem(STORAGE_KEY, sessionId);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the interview simply does not survive a reload */
  }
}

type Phase = "loading" | "consent" | "interview" | "correct";

/**
 * The Morpheo v2 interview (the embudo v0.2, ADR 0020): one question per
 * screen, in the order the engine serves it. The app never decides what comes
 * next -- not the order, not the branches, not the safety questions, not the
 * result: it shows the step morpheo sends and returns the answer to that step.
 *
 * Health-data consent first (read in full; recorded on a signed-in person's
 * account). A signed-in person's interview is saved to them from the start.
 * Staff see the team panel under every step and the result.
 */
export function FunnelAssessment({
  embedded = false,
  me,
}: {
  embedded?: boolean;
  me?: MeResponse;
} = {}) {
  const { t, i18n } = useTranslation();
  const { state: auth } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = auth.status === "authenticated";
  const signedInMe = me ?? (auth.status === "authenticated" ? auth.me : undefined);
  const staff = signedInMe ? accountViewOf(signedInMe).isStaff : false;
  const locale = i18n.resolvedLanguage ?? "es";
  const legalLocale: SupportedLocale = activeLocale();

  const [phase, setPhase] = useState<Phase>("loading");
  const [interview, setInterview] = useState<FunnelState | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const legalQuery = useQuery({
    queryKey: legalDocumentsQuery(legalLocale),
    queryFn: () => edge.getLegalDocuments(legalLocale),
  });
  const consentQuery = useQuery({
    queryKey: CONSENT_STATUS_QUERY,
    queryFn: edge.getConsentStatus,
    enabled: isAuthenticated,
  });
  const healthDocument = legalQuery.data?.documents.find(
    (document) => document.purposeKey === "health_data_processing",
  );
  const healthStatus = consentQuery.data?.purposes.find(
    (purpose) => purpose.purposeKey === "health_data_processing",
  );
  const alreadySigned =
    healthStatus?.consented === true &&
    healthStatus.current &&
    healthStatus.legalDocumentVersionId === healthDocument?.id
      ? healthStatus
      : undefined;

  const focusTop = useCallback(() => {
    requestAnimationFrame(() => {
      heading.current?.focus();
      if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  // A reload resumes the interview in progress; anything else starts at consent.
  useEffect(() => {
    const stored = readStored();
    if (!stored) {
      setPhase("consent");
      return;
    }
    let cancelled = false;
    edge
      .getFunnel(stored, staff)
      .then((state) => {
        if (cancelled) return;
        setInterview(state);
        setPhase("interview");
      })
      .catch(() => {
        if (cancelled) return;
        store(null);
        setPhase("consent");
      });
    return () => {
      cancelled = true;
    };
  }, [staff]);

  const run = useCallback(
    async (call: () => Promise<FunnelState>, next: Phase = "interview") => {
      setBusy(true);
      setError(null);
      try {
        const state = await call();
        setInterview(state);
        store(state.sessionId);
        setPhase(next);
        focusTop();
      } catch (caught) {
        setError(caught instanceof ApiRequestError && caught.reason ? caught.reason : "generic");
      } finally {
        setBusy(false);
      }
    },
    [focusTop],
  );

  async function start() {
    await run(async () => {
      if (isAuthenticated && !alreadySigned) {
        await edge.recordConsent("health_data_processing", CONSENT_SOURCE, legalLocale);
        await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_QUERY });
      }
      return edge.startFunnel(staff);
    });
  }

  function answer(body: AnswerBody) {
    const current = interview;
    if (!current?.step) return;
    const key = current.step.key;
    void run(() => edge.answerFunnel(current.sessionId, { key, ...body }, staff));
  }

  function back() {
    if (interview) void run(() => edge.backFunnel(interview.sessionId, staff));
  }

  function rewind(key: string) {
    if (interview) void run(() => edge.rewindFunnel(interview.sessionId, key, staff));
  }

  function restart() {
    store(null);
    setInterview(null);
    setConsentGiven(false);
    setError(null);
    setPhase("consent");
    focusTop();
  }

  const Wrapper = embedded ? "section" : "main";
  const step = interview?.step ?? null;
  // The report is the whole screen: the intro about questions has no place beside it.
  const atResult = phase === "interview" && step === null && interview?.result != null;

  return (
    <Wrapper
      aria-labelledby="funnel-heading"
      className={
        embedded
          ? "mx-auto flex w-full max-w-3xl flex-col gap-6"
          : "mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6"
      }
    >
      {embedded ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandLogo brand="morpheo" className="h-6 w-auto" />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>
        </div>
      )}
      <header className="flex flex-col gap-1">
        <h1
          id="funnel-heading"
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold sm:text-3xl"
        >
          {t("funnel.title")}
        </h1>
        {atResult ? null : <p className="text-somnus-subtle">{t("funnel.intro")}</p>}
        {locale !== "es" ? (
          <p className="text-sm text-somnus-subtle">{t("funnel.spanishOnly")}</p>
        ) : null}
      </header>

      {phase === "loading" ? <p role="status">{t("funnel.loading")}</p> : null}

      {phase === "consent" ? (
        <section
          aria-labelledby="funnel-consent-heading"
          className="somnus-fade-in flex flex-col gap-5 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5 shadow-lg shadow-black/20 sm:p-7"
        >
          <div className="flex flex-col gap-1">
            <h2 id="funnel-consent-heading" className="text-xl font-semibold">
              {t("assessment.consent.legend")}
            </h2>
            <p className="text-somnus-subtle">{t("assessment.consent.intro")}</p>
          </div>
          {legalQuery.isPending ? (
            <p role="status">{t("legal.loading")}</p>
          ) : !healthDocument ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-somnus-danger">
                {t("legal.loadError")}
              </p>
              <div>
                <Button variant="secondary" onClick={() => void legalQuery.refetch()}>
                  {t("legal.retry")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <LegalDocument
                document={healthDocument}
                {...(alreadySigned?.consentedAt ? { signedAt: alreadySigned.consentedAt } : {})}
                scrollable
              />
              {alreadySigned?.consentedAt ? (
                <p role="status" className="text-somnus-success">
                  {t("assessment.consent.alreadySigned", {
                    date: formatDateTime(alreadySigned.consentedAt, locale),
                  })}
                </p>
              ) : (
                <ChoiceCard
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(event) => setConsentGiven(event.target.checked)}
                  label={t("assessment.consent.label")}
                  hint={
                    isAuthenticated
                      ? t("assessment.consent.recordedHint")
                      : t("funnel.consent.anonymousHint")
                  }
                />
              )}
              <p className="text-sm text-somnus-subtle">{t("assessment.consent.note")}</p>
            </>
          )}
          {error ? <ErrorLine reason={error} /> : null}
          <div className="border-t border-somnus-muted/30 pt-5">
            <Button
              onClick={() => void start()}
              disabled={!healthDocument || busy || (!consentGiven && alreadySigned === undefined)}
            >
              {t("funnel.actions.start")}
            </Button>
          </div>
        </section>
      ) : null}

      {(phase === "interview" || phase === "correct") && interview ? (
        <>
          <FunnelProgress
            phase={step ? step.phase : "result"}
            answered={step ? step.answeredCount : interview.history.length}
          />
          {error ? <ErrorLine reason={error} /> : null}

          {phase === "correct" ? (
            <section
              aria-labelledby="funnel-correct-heading"
              className="flex flex-col gap-4 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5 sm:p-7"
            >
              <h2 id="funnel-correct-heading" className="text-xl font-semibold">
                {t("funnel.correct.title")}
              </h2>
              <p className="text-somnus-subtle">{t("funnel.correct.intro")}</p>
              <ol className="flex flex-col gap-3">
                {interview.history
                  .filter((item) => item.key !== "Z1")
                  .map((item) => (
                    <li
                      key={item.key}
                      className="flex flex-col gap-2 rounded-lg border border-somnus-muted/30 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-somnus-subtle">{item.question}</span>
                        <span className="font-medium">{item.answer}</span>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => rewind(item.key)}
                        aria-label={`${t("funnel.actions.change")}: ${item.question}`}
                      >
                        {t("funnel.actions.change")}
                      </Button>
                    </li>
                  ))}
              </ol>
              <div>
                <Button variant="secondary" onClick={() => setPhase("interview")}>
                  {t("funnel.actions.backToSummary")}
                </Button>
              </div>
            </section>
          ) : step ? (
            <>
              <StepView
                key={step.key}
                step={step}
                busy={busy}
                onAnswer={answer}
                onCorrect={() => setPhase("correct")}
              />
              {step.answeredCount > 0 ? (
                <div>
                  <Button variant="secondary" disabled={busy} onClick={back}>
                    {t("funnel.actions.back")}
                  </Button>
                </div>
              ) : null}
              {step.panel ? <StepPanel panel={step.panel} /> : null}
            </>
          ) : interview.result ? (
            <>
              <FunnelResultView
                result={interview.result}
                sessionId={interview.sessionId}
                owned={interview.owned}
                signedIn={isAuthenticated}
              />
              <div>
                <Button variant="secondary" onClick={restart}>
                  {t("funnel.actions.restart")}
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </Wrapper>
  );
}

function ErrorLine({ reason }: { reason: string }) {
  const { t } = useTranslation();
  const known = ["identifying_data", "invalid_value", "not_the_current_step", "not_answered"];
  return (
    <p role="alert" className="text-somnus-danger">
      {t(`funnel.errors.${known.includes(reason) ? reason : "generic"}`)}
    </p>
  );
}
