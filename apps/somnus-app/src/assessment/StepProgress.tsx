import { useTranslation } from "react-i18next";

export const ASSESSMENT_STEPS = ["role", "consent", "safety", "concern", "result"] as const;
export type AssessmentStep = (typeof ASSESSMENT_STEPS)[number];

/**
 * Where the person is in the questionnaire: a labelled list of the five steps
 * (the current one marked with aria-current) and a bar showing how far along
 * they are. The text says the step number, so progress is never colour alone.
 */
export function StepProgress({ step }: { step: AssessmentStep }) {
  const { t } = useTranslation();
  const index = ASSESSMENT_STEPS.indexOf(step);
  const percent = Math.round(((index + 1) / ASSESSMENT_STEPS.length) * 100);

  return (
    <nav aria-label={t("assessment.progress.label")} className="flex flex-col gap-3">
      <p className="text-sm text-somnus-subtle">
        {t("assessment.progress.stepOf", {
          current: index + 1,
          total: ASSESSMENT_STEPS.length,
          name: t(`assessment.steps.${step}`),
        })}
      </p>
      <div
        aria-hidden="true"
        className="h-1.5 w-full overflow-hidden rounded-full bg-somnus-muted/30"
      >
        <div
          className="h-full rounded-full bg-somnus-primary-strong transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="hidden gap-2 text-xs sm:flex">
        {ASSESSMENT_STEPS.map((name, position) => (
          <li
            key={name}
            aria-current={name === step ? "step" : undefined}
            className={
              name === step
                ? "font-semibold text-somnus-text underline decoration-somnus-primary decoration-2 underline-offset-4"
                : position < index
                  ? "text-somnus-subtle"
                  : "text-somnus-subtle"
            }
          >
            {position < index ? (
              <span aria-hidden="true" className="mr-1 text-somnus-success">
                ✓
              </span>
            ) : null}
            {position + 1}. {t(`assessment.steps.${name}`)}
          </li>
        ))}
      </ol>
    </nav>
  );
}
