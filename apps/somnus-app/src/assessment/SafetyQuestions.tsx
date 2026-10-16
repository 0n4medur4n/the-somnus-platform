import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";
import { Button } from "../components/Button.js";

export type SafetyAnswer = "yes" | "no" | "unknown";
const OPTIONS: SafetyAnswer[] = ["yes", "no", "unknown"];

/** How long a chosen answer stays on screen, then how long the question takes to leave. */
const SHOW_CHOICE_MS = 220;
const FADE_OUT_MS = 180;

/**
 * The safety questions, one at a time: the question fades in, the person
 * answers, it fades out and the next one comes in. Every question is answered
 * ("No lo sé" is an answer); after the last one the step is done. Nothing is
 * decided here -- the answers go to Morpheo together, as before, and its rules
 * set the level.
 *
 * Buttons, not radios: in a radio group the arrow keys change the selection,
 * which here would move a keyboard user on to the next question by accident.
 * Each new question takes focus, so a screen reader reads it out.
 */
export function SafetyQuestions({
  prompts,
  answers,
  onAnswer,
  onBack,
  onComplete,
  busy,
}: {
  prompts: { signalId: string; question: string }[];
  answers: Record<string, SafetyAnswer>;
  onAnswer: (signalId: string, answer: SafetyAnswer) => void;
  /** Leave the step from its first question. */
  onBack: () => void;
  /**
   * All questions answered. Receives the complete answers, the last one
   * included: the parent's state may not have caught up with it yet.
   */
  onComplete: (answers: Record<string, SafetyAnswer>) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const moving = useRef(false);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const questionId = useId();
  const total = prompts.length;
  const prompt = prompts[Math.min(index, total - 1)];

  // Each question after the first takes focus when it arrives.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    questionRef.current?.focus({ preventScroll: true });
  }, [index]);

  function moveTo(next: number) {
    if (moving.current) return;
    moving.current = true;
    setLeaving(true);
    setTimeout(() => {
      setIndex(next);
      setLeaving(false);
      moving.current = false;
    }, FADE_OUT_MS);
  }

  function choose(answer: SafetyAnswer) {
    if (!prompt || moving.current || busy) return;
    onAnswer(prompt.signalId, answer);
    const complete = { ...answers, [prompt.signalId]: answer };
    setTimeout(() => {
      if (index + 1 >= total) onComplete(complete);
      else moveTo(index + 1);
    }, SHOW_CHOICE_MS);
  }

  if (!prompt) {
    // No questions apply: nothing to ask, the step is done.
    return (
      <div className="flex justify-between gap-3">
        <Button variant="secondary" onClick={onBack}>
          {t("assessment.actions.back")}
        </Button>
        <Button onClick={() => onComplete(answers)} disabled={busy}>
          {t("assessment.actions.next")}
        </Button>
      </div>
    );
  }

  const answered = answers[prompt.signalId];
  const progress = Math.round(((index + (answered ? 1 : 0)) / total) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-somnus-subtle" aria-live="polite">
          {t("assessment.safety.questionOf", { current: index + 1, total })}
        </p>
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-somnus-muted/25">
          <div
            className="h-full rounded-full bg-somnus-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div
        key={prompt.signalId}
        className={twMerge(
          "flex min-h-56 flex-col gap-6",
          leaving ? "somnus-fade-out" : "somnus-fade-in",
        )}
      >
        <h3
          ref={questionRef}
          id={questionId}
          tabIndex={-1}
          data-testid="safety-question"
          className="text-xl font-semibold leading-snug sm:text-2xl"
        >
          {prompt.question}
        </h3>
        <fieldset
          aria-labelledby={questionId}
          className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-3"
        >
          {OPTIONS.map((option) => {
            const selected = answered === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => choose(option)}
                className={twMerge(
                  "rounded-xl border border-somnus-muted/40 bg-somnus-surface/60 px-4 py-4 text-base font-medium transition-[background-color,border-color,transform] duration-150",
                  "hover:border-somnus-primary/70 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
                  selected && "border-somnus-primary-strong bg-somnus-primary-strong text-white",
                )}
              >
                {t(`assessment.safety.${option}`)}
              </button>
            );
          })}
        </fieldset>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-somnus-muted/30 pt-5">
        <Button
          variant="secondary"
          onClick={() => (index === 0 ? onBack() : moveTo(index - 1))}
          disabled={busy}
        >
          {t("assessment.actions.back")}
        </Button>
        {answered && index + 1 < total ? (
          <Button variant="secondary" onClick={() => moveTo(index + 1)} disabled={busy}>
            {t("assessment.actions.next")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
