import {
  type AssessmentCreateRequest,
  type AssessmentResult,
  ageOnDate,
  type GateReason,
  type MeResponse,
  type RoleId,
  type SupportedLocale,
} from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ResultView } from "../assessment/ResultView.js";
import { type SafetyAnswer, SafetyQuestions } from "../assessment/SafetyQuestions.js";
import { type AssessmentStep, StepProgress } from "../assessment/StepProgress.js";
import { accountViewOf } from "../auth/account-view.js";
import { useAuth } from "../auth/useAuth.js";
import { BrandLogo } from "../components/BrandLogo.js";
import { Button } from "../components/Button.js";
import { ChoiceCard } from "../components/ChoiceCard.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";
import { formatDateTime, LegalDocument } from "../components/LegalDocument.js";
import { ThemeSwitcher } from "../components/ThemeSwitcher.js";
import { activeLocale } from "../i18n/index.js";
import { MorpheoLayout } from "../layouts/MorpheoLayout.js";
import { edge } from "../lib/edge.js";
import { ASSESSMENT_CONTENT_QUERY, OWN_ASSESSMENTS_QUERY } from "./MorpheoHome.js";

const ROLES: RoleId[] = ["adult", "parent", "professional"];
/** A Morpheo user assesses themselves or a minor in their care; the professional path is not theirs. */
const MORPHEO_USER_ROLES: RoleId[] = ["adult", "parent"];

export const legalDocumentsQuery = (locale: SupportedLocale) =>
  ["legal-documents", locale] as const;
export const CONSENT_STATUS_QUERY = ["consent-status"] as const;
/** Where a health-data consent given in the questionnaire is recorded from. */
const CONSENT_SOURCE = "morpheo-assessment";

/**
 * `/assessment`. A signed-in Morpheo user takes the questionnaire inside their
 * own space; everyone else gets the public page.
 */
export function AssessmentRoute() {
  const { t } = useTranslation();
  const { state } = useAuth();
  if (state.status === "loading") return <FullPageStatus message={t("common.loading")} />;
  if (state.status === "authenticated" && accountViewOf(state.me).isMorpheoUser) {
    return (
      <MorpheoLayout brand="morpheo">
        <Assessment embedded me={state.me} />
      </MorpheoLayout>
    );
  }
  return <Assessment />;
}

/** The role a Morpheo user registered for, and their age when it is known. */
function presetFor(me: MeResponse | undefined): { role: RoleId | null; age: string } {
  if (!me) return { role: null, age: "" };
  const kind = accountViewOf(me).kind;
  const role = kind === "adult" || kind === "parent" ? kind : null;
  const dateOfBirth = me.individualProfile?.dateOfBirth;
  const age = role === "adult" && dateOfBirth ? String(ageOnDate(dateOfBirth, new Date())) : "";
  return { role, age };
}

function StepCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="step-heading"
      className="somnus-fade-in flex flex-col gap-5 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5 shadow-lg shadow-black/20 sm:p-7"
    >
      <div className="flex flex-col gap-1">
        <h2 id="step-heading" className="text-xl font-semibold">
          {title}
        </h2>
        {intro ? <p className="text-somnus-subtle">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StepActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-somnus-muted/30 pt-5 sm:flex-row sm:justify-between">
      {children}
    </div>
  );
}

function SubmitError({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <p role="alert" className="text-somnus-danger">
      {t("assessment.submitError")}
    </p>
  );
}

/**
 * The anonymous assessment flow (build plan §20 Checkpoint 10.3, state machine
 * §14a): role → consent → SAFETY-FIRST questions → (stop on an emergency) →
 * concern → the §14b result. Public (no session). The safety questions and
 * every clinical string come from the morpheo content endpoint — the SPA never
 * authors clinical text. "No lo sé" maps to unknown, never No (§14).
 *
 * The health-data consent is read in full before it is given (build plan §13):
 * the current document is shown with its version and fingerprint, and a
 * signed-in person's consent is recorded as a receipt against that version.
 */
export function Assessment({
  embedded = false,
  me,
}: {
  /** Inside the Morpheo user's own space (which owns the page's main landmark). */
  embedded?: boolean;
  /** The signed-in Morpheo user, when embedded. */
  me?: MeResponse;
} = {}) {
  const { t, i18n } = useTranslation();
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = state.status === "authenticated";
  const preset = useMemo(() => presetFor(me), [me]);
  const roleOptions = me ? MORPHEO_USER_ROLES : ROLES;
  const locale = i18n.resolvedLanguage ?? "es";

  const contentQuery = useQuery({
    queryKey: ASSESSMENT_CONTENT_QUERY,
    queryFn: edge.getAssessmentContent,
  });
  const legalLocale = activeLocale();
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
  // Already given against the version in force: shown as signed, not asked again.
  const alreadySigned =
    healthStatus?.consented === true &&
    healthStatus.current &&
    healthStatus.legalDocumentVersionId === healthDocument?.id
      ? healthStatus
      : undefined;

  const [step, setStep] = useState<AssessmentStep>("role");
  const [role, setRole] = useState<RoleId | null>(preset.role);
  const [ageYears, setAgeYears] = useState(preset.age);
  const [guardianshipConfirmed, setGuardianshipConfirmed] = useState(false);
  const [professionalConfirmed, setProfessionalConfirmed] = useState(false);
  const [containsIdentifiableData, setContainsIdentifiableData] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [safetyAnswers, setSafetyAnswers] = useState<Record<string, SafetyAnswer>>({});
  const [complaints, setComplaints] = useState<string[]>([]);

  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [blocked, setBlocked] = useState<GateReason | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** The session already saved (or being saved), so a result is saved once. */
  const savingFor = useRef<string | null>(null);
  /** This flow's health consent is on record (given now, or already in force). */
  const consentRecorded = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const complaintOptions = useMemo(
    () =>
      contentQuery.data
        ? Array.from(new Set(contentQuery.data.modules.flatMap((module) => module.entry)))
        : [],
    [contentQuery.data],
  );

  // Pediatric questions ("su hijo o hija …") show only under the parent role.
  const safetyPrompts = useMemo(
    () =>
      contentQuery.data
        ? contentQuery.data.safetyPrompts
            .filter((prompt) => prompt.context === "general" || role === "parent")
            // Each audience reads the same question in its own voice: "tú",
            // "tu hijo o hija", "la persona a la que valoras" (content 1.4).
            .map((prompt) => ({
              signalId: prompt.signalId,
              question: (role ? prompt.questionByRole[role] : undefined) ?? prompt.question,
            }))
        : [],
    [contentQuery.data, role],
  );

  const roleValid =
    role === "professional"
      ? professionalConfirmed
      : role !== null && ageYears.trim().length > 0 && Number.isFinite(Number(ageYears));

  // Each step starts at the top with focus on its title, so a screen reader
  // hears where they are and a phone user is not left mid-page.
  const goTo = useCallback((next: AssessmentStep) => {
    setStep(next);
    requestAnimationFrame(() => {
      heading.current?.focus();
      if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  function reset(next: AssessmentStep) {
    goTo(next);
    setResult(null);
    setBlocked(null);
    setSubmitError(false);
  }

  function restart() {
    goTo("role");
    setRole(preset.role);
    setAgeYears(preset.age);
    setGuardianshipConfirmed(false);
    setProfessionalConfirmed(false);
    setContainsIdentifiableData(false);
    setConsentGiven(false);
    setSafetyAnswers({});
    setComplaints([]);
    setResult(null);
    setBlocked(null);
    setSessionId(null);
    setSubmitError(false);
    setSaved(false);
    setSaveFailed(false);
    savingFor.current = null;
  }

  /** Records the health-data consent once per flow, for a signed-in person. */
  const recordHealthConsent = useCallback(async () => {
    if (!isAuthenticated || consentRecorded.current) return;
    if (alreadySigned) {
      consentRecorded.current = true;
      return;
    }
    await edge.recordConsent("health_data_processing", CONSENT_SOURCE, legalLocale);
    consentRecorded.current = true;
    await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_QUERY });
  }, [isAuthenticated, alreadySigned, queryClient, legalLocale]);

  async function startSession() {
    if (role === null) return;
    setSubmitting(true);
    setSubmitError(false);
    setBlocked(null);
    try {
      await recordHealthConsent();
      const payload: AssessmentCreateRequest = {
        role,
        consentGiven: consentGiven || alreadySigned !== undefined,
        ...(role !== "professional" ? { ageYears: Number(ageYears) } : {}),
        ...(role === "parent" ? { guardianshipConfirmed } : {}),
        ...(role === "professional" ? { professionalConfirmed, containsIdentifiableData } : {}),
      };
      const created = await edge.createAssessment(payload);
      if (!created.allowed || created.sessionId === null) {
        setBlocked(created.reason ?? "ineligible");
        goTo("result");
        return;
      }
      setSessionId(created.sessionId);
      goTo("safety");
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSafety(answers: Record<string, SafetyAnswer> = safetyAnswers) {
    if (sessionId === null) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      for (const [signalId, answer] of Object.entries(answers)) {
        const value = answer === "yes" ? "true" : answer === "no" ? "false" : "unknown";
        await edge.submitAssessmentAnswer(sessionId, { kind: "signal", name: signalId, value });
      }
      const summary = await edge.getAssessmentSummary(sessionId);
      // Safety-first: an emergency stop short-circuits the rest of the flow.
      if (summary.stop) {
        setResult(summary);
        goTo("result");
      } else {
        goTo("concern");
      }
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function finishWithComplaints() {
    if (sessionId === null) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      for (const phrase of complaints) {
        await edge.submitAssessmentAnswer(sessionId, { kind: "complaint", name: phrase });
      }
      setResult(await edge.getAssessmentSummary(sessionId));
      goTo("result");
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const save = useCallback(async () => {
    if (sessionId === null) return;
    savingFor.current = sessionId;
    setSaveFailed(false);
    try {
      // Saving to an account is where an anonymous person's consent becomes theirs.
      await recordHealthConsent();
      const { token } = await edge.requestAssessmentClaimToken(sessionId);
      const outcome = await edge.claimAssessment(token);
      if (outcome.success) {
        setSaved(true);
        await queryClient.invalidateQueries({ queryKey: OWN_ASSESSMENTS_QUERY });
      } else {
        setSaveFailed(true);
      }
    } catch {
      setSaveFailed(true);
    }
  }, [sessionId, queryClient, recordHealthConsent]);

  // Inside their own space, a result is saved to the account as soon as it is
  // shown -- the history is the point of having one. Once per session.
  useEffect(() => {
    if (embedded && step === "result" && result && sessionId && savingFor.current !== sessionId) {
      void save();
    }
  }, [embedded, step, result, sessionId, save]);

  const Wrapper = embedded ? "section" : "main";

  if (contentQuery.isPending) {
    return <p role="status">{t("assessment.loadingContent")}</p>;
  }
  if (contentQuery.isError) {
    return (
      <p role="alert" className="text-somnus-danger">
        {t("assessment.contentError")}
      </p>
    );
  }

  const primaryLink =
    "inline-flex items-center justify-center rounded-md bg-somnus-primary-strong px-4 py-2 font-medium text-white hover:brightness-110";

  return (
    // The public route has no app-shell layout, so the page owns its `main`
    // landmark (a11y baseline: one main landmark per document). Embedded in
    // the Morpheo space, the layout owns it.
    <Wrapper
      aria-labelledby="assessment-heading"
      className={
        embedded
          ? "mx-auto flex w-full max-w-3xl flex-col gap-6"
          : "mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6"
      }
    >
      {embedded ? null : (
        // The public page has no app shell: its own Morpheo mark, appearance and
        // language controls (embedded, the Morpheo layout's header carries them).
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
          id="assessment-heading"
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold sm:text-3xl"
        >
          {t("assessment.title")}
        </h1>
        <p className="text-somnus-subtle">{t("assessment.intro")}</p>
      </header>

      <StepProgress step={step} />

      {step === "role" ? (
        <StepCard title={t("assessment.role.title")} intro={t("assessment.role.intro")}>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 font-medium">{t("assessment.role.legend")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {roleOptions.map((option) => (
                <ChoiceCard
                  key={option}
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                  label={t(`assessment.role.${option}`)}
                  hint={t(`assessment.role.${option}Hint`)}
                />
              ))}
            </div>
          </fieldset>

          {role === "adult" || role === "parent" ? (
            <label className="flex flex-col gap-1">
              <span className="font-medium">
                {t(role === "parent" ? "assessment.role.ageMinor" : "assessment.role.ageAdult")}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                value={ageYears}
                onChange={(event) => setAgeYears(event.target.value)}
                className="w-36 rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-lg"
              />
            </label>
          ) : null}

          {role === "parent" ? (
            <ChoiceCard
              type="checkbox"
              checked={guardianshipConfirmed}
              onChange={(event) => setGuardianshipConfirmed(event.target.checked)}
              label={t("assessment.role.guardianship")}
            />
          ) : null}

          {role === "professional" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-somnus-subtle">{t("assessment.role.professionalNote")}</p>
              <ChoiceCard
                type="checkbox"
                checked={professionalConfirmed}
                onChange={(event) => setProfessionalConfirmed(event.target.checked)}
                label={t("assessment.role.professionalConfirm")}
              />
              <ChoiceCard
                type="checkbox"
                checked={containsIdentifiableData}
                onChange={(event) => setContainsIdentifiableData(event.target.checked)}
                label={t("assessment.role.identifiable")}
              />
            </div>
          ) : null}

          <StepActions>
            <span />
            <Button onClick={() => reset("consent")} disabled={!roleValid}>
              {t("assessment.actions.next")}
            </Button>
          </StepActions>
        </StepCard>
      ) : null}

      {step === "consent" ? (
        <StepCard title={t("assessment.consent.legend")} intro={t("assessment.consent.intro")}>
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
                      : t("assessment.consent.anonymousHint")
                  }
                />
              )}
              <p className="text-sm text-somnus-subtle">{t("assessment.consent.note")}</p>
            </>
          )}
          <SubmitError show={submitError} />
          <StepActions>
            <Button variant="secondary" onClick={() => goTo("role")}>
              {t("assessment.actions.back")}
            </Button>
            <Button
              onClick={startSession}
              disabled={
                !healthDocument || submitting || (!consentGiven && alreadySigned === undefined)
              }
            >
              {t("assessment.actions.next")}
            </Button>
          </StepActions>
        </StepCard>
      ) : null}

      {step === "safety" ? (
        <StepCard title={t("assessment.safety.legend")} intro={t("assessment.safety.intro")}>
          <SafetyQuestions
            prompts={safetyPrompts}
            answers={safetyAnswers}
            onAnswer={(signalId, answer) =>
              setSafetyAnswers((current) => ({ ...current, [signalId]: answer }))
            }
            onBack={() => goTo("consent")}
            onComplete={submitSafety}
            busy={submitting}
          />
          {submitting ? (
            <p role="status" className="text-sm text-somnus-subtle">
              {t("assessment.safety.checking")}
            </p>
          ) : null}
          <SubmitError show={submitError} />
          {submitError ? (
            <Button onClick={() => submitSafety()} disabled={submitting} className="self-start">
              {t("assessment.actions.retrySave")}
            </Button>
          ) : null}
        </StepCard>
      ) : null}

      {step === "concern" ? (
        <StepCard title={t("assessment.concern.legend")} intro={t("assessment.concern.intro")}>
          <fieldset>
            <legend className="sr-only">{t("assessment.concern.legend")}</legend>
            {complaintOptions.length === 0 ? (
              <p>{t("assessment.concern.empty")}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {complaintOptions.map((phrase) => (
                  <ChoiceCard
                    key={phrase}
                    type="checkbox"
                    checked={complaints.includes(phrase)}
                    onChange={() =>
                      setComplaints((current) =>
                        current.includes(phrase)
                          ? current.filter((item) => item !== phrase)
                          : [...current, phrase],
                      )
                    }
                    label={phrase}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <p className="text-sm text-somnus-subtle" aria-live="polite">
            {t("assessment.concern.selected", { count: complaints.length })}
          </p>
          <SubmitError show={submitError} />
          <StepActions>
            <Button variant="secondary" onClick={() => goTo("safety")}>
              {t("assessment.actions.back")}
            </Button>
            <Button onClick={finishWithComplaints} disabled={submitting || complaints.length === 0}>
              {t("assessment.actions.seeResult")}
            </Button>
          </StepActions>
        </StepCard>
      ) : null}

      {step === "result" ? (
        <div className="flex flex-col gap-6">
          {blocked ? (
            <div
              role="alert"
              className="flex flex-col gap-1 rounded-2xl border border-somnus-danger/50 bg-somnus-danger/10 p-5"
            >
              <h2 className="text-xl font-semibold">{t("assessment.result.blockedTitle")}</h2>
              <p>{t(`assessment.result.blocked.${blocked}`)}</p>
            </div>
          ) : result ? (
            <>
              <ResultView result={result} content={contentQuery.data} complaints={complaints} />
              {embedded ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5">
                  {saved ? (
                    <>
                      <p role="status" aria-live="polite" className="text-somnus-success">
                        {t("assessment.result.autoSaved")}
                      </p>
                      <div>
                        <Link to="/app" className={primaryLink}>
                          {t("assessment.actions.goToSpace")}
                        </Link>
                      </div>
                    </>
                  ) : saveFailed ? (
                    <div className="flex flex-col gap-2">
                      <p role="alert" className="text-somnus-danger">
                        {t("assessment.result.saveFailed")}
                      </p>
                      <div>
                        <Button onClick={() => void save()}>
                          {t("assessment.actions.retrySave")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p role="status" aria-live="polite" className="text-somnus-subtle">
                      {t("assessment.result.autoSaving")}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5">
                  <p className="text-sm text-somnus-subtle">{t("assessment.result.saveHint")}</p>
                  {saved ? (
                    <p role="status" aria-live="polite" className="text-somnus-success">
                      {t("assessment.result.saved")}
                    </p>
                  ) : isAuthenticated ? (
                    <>
                      <div>
                        <Button onClick={() => void save()}>{t("assessment.actions.save")}</Button>
                      </div>
                      {saveFailed ? (
                        <p role="alert" className="text-somnus-danger">
                          {t("assessment.submitError")}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <Link to="/login" className="text-somnus-primary underline underline-offset-2">
                      {t("assessment.actions.login")}
                    </Link>
                  )}
                </div>
              )}
            </>
          ) : null}
          <div>
            <Button variant="secondary" onClick={restart}>
              {t("assessment.actions.restart")}
            </Button>
          </div>
        </div>
      ) : null}
    </Wrapper>
  );
}
