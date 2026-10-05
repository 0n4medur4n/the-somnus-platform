import {
  type AssessmentCreateRequest,
  type AssessmentResult,
  ageOnDate,
  type GateReason,
  type MeResponse,
  type RoleId,
} from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ResultView } from "../assessment/ResultView.js";
import { accountViewOf } from "../auth/account-view.js";
import { useAuth } from "../auth/useAuth.js";
import { Button } from "../components/Button.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { MorpheoLayout } from "../layouts/MorpheoLayout.js";
import { edge } from "../lib/edge.js";
import { ASSESSMENT_CONTENT_QUERY, OWN_ASSESSMENTS_QUERY } from "./MorpheoHome.js";

type Step = "role" | "consent" | "safety" | "concern" | "result";
type SafetyAnswer = "yes" | "no" | "unknown";
const ROLES: RoleId[] = ["adult", "parent", "professional"];
/** A Morpheo user assesses themselves or a minor in their care; the professional path is not theirs. */
const MORPHEO_USER_ROLES: RoleId[] = ["adult", "parent"];
const SAFETY_OPTIONS: SafetyAnswer[] = ["yes", "no", "unknown"];

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
      <MorpheoLayout>
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

/**
 * The anonymous assessment flow (build plan §20 Checkpoint 10.3, state machine
 * §14a): role → consent → SAFETY-FIRST questions → (stop on an emergency) →
 * concern → the §14b result. Public (no session). The safety questions and
 * every clinical string come from the morpheo content endpoint — the SPA never
 * authors clinical text. "No lo sé" maps to unknown, never No (§14).
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
  const { t } = useTranslation();
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = state.status === "authenticated";
  const preset = useMemo(() => presetFor(me), [me]);
  const roleOptions = me ? MORPHEO_USER_ROLES : ROLES;

  const contentQuery = useQuery({
    queryKey: ASSESSMENT_CONTENT_QUERY,
    queryFn: edge.getAssessmentContent,
  });

  const [step, setStep] = useState<Step>("role");
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
        ? contentQuery.data.safetyPrompts.filter(
            (prompt) => prompt.context === "general" || role === "parent",
          )
        : [],
    [contentQuery.data, role],
  );

  const roleValid =
    role === "professional"
      ? professionalConfirmed
      : role !== null && ageYears.trim().length > 0 && Number.isFinite(Number(ageYears));

  function reset(next: Step) {
    setStep(next);
    setResult(null);
    setBlocked(null);
    setSubmitError(false);
  }

  function restart() {
    setStep("role");
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

  async function startSession() {
    if (role === null) return;
    setSubmitting(true);
    setSubmitError(false);
    setBlocked(null);
    try {
      const payload: AssessmentCreateRequest = {
        role,
        consentGiven,
        ...(role !== "professional" ? { ageYears: Number(ageYears) } : {}),
        ...(role === "parent" ? { guardianshipConfirmed } : {}),
        ...(role === "professional" ? { professionalConfirmed, containsIdentifiableData } : {}),
      };
      const created = await edge.createAssessment(payload);
      if (!created.allowed || created.sessionId === null) {
        setBlocked(created.reason ?? "ineligible");
        setStep("result");
        return;
      }
      setSessionId(created.sessionId);
      setStep("safety");
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSafety() {
    if (sessionId === null) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      for (const [signalId, answer] of Object.entries(safetyAnswers)) {
        const value = answer === "yes" ? "true" : answer === "no" ? "false" : "unknown";
        await edge.submitAssessmentAnswer(sessionId, { kind: "signal", name: signalId, value });
      }
      const summary = await edge.getAssessmentSummary(sessionId);
      // Safety-first: an emergency stop short-circuits the rest of the flow.
      if (summary.stop) {
        setResult(summary);
        setStep("result");
      } else {
        setStep("concern");
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
      setStep("result");
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
  }, [sessionId, queryClient]);

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

  return (
    // The public route has no app-shell layout, so the page owns its `main`
    // landmark (a11y baseline: one main landmark per document). Embedded in
    // the Morpheo space, the layout owns it.
    <Wrapper
      aria-labelledby="assessment-heading"
      className={
        embedded ? "flex max-w-2xl flex-col gap-6" : "mx-auto flex max-w-2xl flex-col gap-6 p-6"
      }
    >
      <div>
        <h1 id="assessment-heading" className="text-2xl font-semibold">
          {t("assessment.title")}
        </h1>
        <p className="mt-1 text-somnus-subtle">{t("assessment.intro")}</p>
      </div>

      {step === "role" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-medium">{t("assessment.role.legend")}</legend>
          {roleOptions.map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input
                type="radio"
                name="role"
                value={option}
                checked={role === option}
                onChange={() => setRole(option)}
              />
              {t(`assessment.role.${option}`)}
            </label>
          ))}

          {role === "adult" || role === "parent" ? (
            <label className="mt-2 flex flex-col gap-1">
              <span className="text-sm font-medium">
                {t(role === "parent" ? "assessment.role.ageMinor" : "assessment.role.ageAdult")}
              </span>
              <input
                type="number"
                min={0}
                max={120}
                value={ageYears}
                onChange={(event) => setAgeYears(event.target.value)}
                className="w-32 rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2"
              />
            </label>
          ) : null}

          {role === "parent" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={guardianshipConfirmed}
                onChange={(event) => setGuardianshipConfirmed(event.target.checked)}
              />
              {t("assessment.role.guardianship")}
            </label>
          ) : null}

          {role === "professional" ? (
            <>
              <p className="text-sm text-somnus-subtle">{t("assessment.role.professionalNote")}</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={professionalConfirmed}
                  onChange={(event) => setProfessionalConfirmed(event.target.checked)}
                />
                {t("assessment.role.professionalConfirm")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={containsIdentifiableData}
                  onChange={(event) => setContainsIdentifiableData(event.target.checked)}
                />
                {t("assessment.role.identifiable")}
              </label>
            </>
          ) : null}

          <div className="mt-2">
            <Button onClick={() => reset("consent")} disabled={!roleValid}>
              {t("assessment.actions.next")}
            </Button>
          </div>
        </fieldset>
      ) : null}

      {step === "consent" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-medium">{t("assessment.consent.legend")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(event) => setConsentGiven(event.target.checked)}
            />
            {t("assessment.consent.label")}
          </label>
          <p className="text-sm text-somnus-subtle">{t("assessment.consent.note")}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("role")}>
              {t("assessment.actions.back")}
            </Button>
            <Button onClick={startSession} disabled={!consentGiven || submitting}>
              {t("assessment.actions.next")}
            </Button>
          </div>
          {submitError ? (
            <p role="alert" className="text-somnus-danger">
              {t("assessment.submitError")}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {step === "safety" ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-medium">{t("assessment.safety.legend")}</h2>
            <p className="text-sm text-somnus-subtle">{t("assessment.safety.intro")}</p>
          </div>
          {safetyPrompts.map((prompt) => (
            <fieldset key={prompt.signalId} className="flex flex-col gap-1">
              <legend className="text-sm font-medium">{prompt.question}</legend>
              <div className="flex gap-4">
                {SAFETY_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={prompt.signalId}
                      checked={safetyAnswers[prompt.signalId] === option}
                      onChange={() =>
                        setSafetyAnswers((current) => ({ ...current, [prompt.signalId]: option }))
                      }
                    />
                    {t(`assessment.safety.${option}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("consent")}>
              {t("assessment.actions.back")}
            </Button>
            <Button onClick={submitSafety} disabled={submitting}>
              {t("assessment.actions.next")}
            </Button>
          </div>
          {submitError ? (
            <p role="alert" className="text-somnus-danger">
              {t("assessment.submitError")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "concern" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-medium">{t("assessment.concern.legend")}</legend>
          {complaintOptions.length === 0 ? (
            <p>{t("assessment.concern.empty")}</p>
          ) : (
            complaintOptions.map((phrase) => (
              <label key={phrase} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={complaints.includes(phrase)}
                  onChange={() =>
                    setComplaints((current) =>
                      current.includes(phrase)
                        ? current.filter((item) => item !== phrase)
                        : [...current, phrase],
                    )
                  }
                />
                {phrase}
              </label>
            ))
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("safety")}>
              {t("assessment.actions.back")}
            </Button>
            <Button onClick={finishWithComplaints} disabled={submitting || complaints.length === 0}>
              {t("assessment.actions.seeResult")}
            </Button>
          </div>
          {submitError ? (
            <p role="alert" className="text-somnus-danger">
              {t("assessment.submitError")}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {step === "result" ? (
        <div className="flex flex-col gap-6">
          {blocked ? (
            <div role="alert" className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">{t("assessment.result.blockedTitle")}</h2>
              <p>{t(`assessment.result.blocked.${blocked}`)}</p>
            </div>
          ) : result ? (
            <>
              <ResultView result={result} content={contentQuery.data} complaints={complaints} />
              {embedded ? (
                <div className="flex flex-col gap-3 border-t border-somnus-muted/30 pt-4">
                  {saved ? (
                    <>
                      <p role="status" aria-live="polite" className="text-somnus-success">
                        {t("assessment.result.autoSaved")}
                      </p>
                      <div>
                        <Link
                          to="/app"
                          className="inline-flex items-center justify-center rounded-md bg-somnus-primary-strong px-4 py-2 font-medium text-white hover:brightness-110"
                        >
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
                <div className="flex flex-col gap-2 border-t border-somnus-muted/30 pt-4">
                  <p className="text-sm text-somnus-subtle">{t("assessment.result.saveHint")}</p>
                  {saved ? (
                    <p role="status" aria-live="polite" className="text-somnus-success">
                      {t("assessment.result.saved")}
                    </p>
                  ) : isAuthenticated ? (
                    <>
                      <Button onClick={() => void save()}>{t("assessment.actions.save")}</Button>
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
