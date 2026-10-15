import type { AssessmentContentResponse, AssessmentResult } from "@somnus/api-contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";

type ResultViewProps = {
  result: AssessmentResult;
  content: AssessmentContentResponse;
  complaints: string[];
};

/**
 * Each level's accent, from the clinical artifact's own `color` field
 * (L0 red … L4 blue). Presentation only: the level itself, its name and its
 * action all come from morpheo.
 */
const LEVEL_ACCENT: Record<string, string> = {
  L0: "border-red-500/70 bg-red-500/15",
  L1: "border-orange-500/70 bg-orange-500/15",
  L2: "border-amber-400/70 bg-amber-400/10",
  L3: "border-teal-400/60 bg-teal-400/10",
  L4: "border-sky-400/60 bg-sky-400/10",
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-somnus-muted/30 bg-somnus-surface/60 p-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Renders the §14b output contract from the deterministic result + the approved
 * artifact wording (build plan §20 Checkpoint 10.3). Every clinical string here
 * comes from the morpheo content endpoint — the SPA never authors clinical
 * text. The "with the information available" framing shows on every L3/L4.
 * When the flow stopped on a safety rule, the care level and its action come
 * first, before anything else on the page.
 */
export function ResultView({ result, content, complaints }: ResultViewProps) {
  const { t } = useTranslation();
  const moduleById = new Map(content.modules.map((module) => [module.id, module]));
  const routed = result.routes
    .map((id) => moduleById.get(id))
    .filter((module): module is NonNullable<typeof module> => module !== undefined);
  const level = result.level
    ? content.safetyLevels.find((safety) => safety.id === result.level)
    : undefined;
  const showFraming = result.level === "L3" || result.level === "L4";

  const levelCard = level ? (
    <section
      aria-labelledby="care-level-heading"
      role={result.stop ? "alert" : undefined}
      className={twMerge(
        "flex flex-col gap-2 rounded-2xl border-2 p-5 sm:p-6",
        LEVEL_ACCENT[level.id] ?? "border-somnus-muted/40",
      )}
    >
      <h3 id="care-level-heading" className="text-sm font-semibold uppercase tracking-wide">
        {t("assessment.result.careLevel")}
      </h3>
      {showFraming ? <p className="text-somnus-subtle">{t("assessment.result.framing")}</p> : null}
      <p className="text-2xl font-semibold">{level.name}</p>
      <p className="text-lg leading-relaxed">{level.action}</p>
    </section>
  ) : null;

  const summary =
    routed.length > 0 ? (
      <Block title={t("assessment.result.summary")}>
        <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed">
          {routed.map((module) => (
            <li key={module.id}>{module.output}</li>
          ))}
        </ul>
      </Block>
    ) : null;

  return (
    <section aria-labelledby="assessment-result-heading" className="flex flex-col gap-4">
      <h2 id="assessment-result-heading" className="text-2xl font-semibold">
        {t("assessment.result.title")}
      </h2>

      {result.stop ? (
        <>
          {levelCard}
          {summary}
        </>
      ) : (
        <>
          {summary}
          {levelCard}
        </>
      )}

      {routed.length > 0 ? (
        <Block title={t("assessment.result.patterns")}>
          <ul className="flex flex-col gap-3">
            {routed.slice(0, 3).map((module) => {
              const facts = module.entry.filter((phrase) => complaints.includes(phrase));
              return (
                <li key={module.id} className="flex flex-col">
                  <span className="font-medium">{module.name}</span>
                  {facts.length > 0 ? (
                    <span className="text-sm text-somnus-subtle">
                      {t("assessment.result.triggeredBy", { facts: facts.join(", ") })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}

      <Block title={t("assessment.result.unknown")}>
        <p>{t("assessment.result.unknownDeferred")}</p>
      </Block>

      {routed.length > 0 ? (
        <Block title={t("assessment.result.prepare")}>
          <ul className="flex flex-col gap-2">
            {routed.flatMap((module) =>
              module.minimumQuestions.map((question) => (
                <li key={`${module.id}:${question}`} className="flex gap-2">
                  <span aria-hidden="true" className="text-somnus-primary">
                    ☐
                  </span>
                  <span>{question}</span>
                </li>
              )),
            )}
          </ul>
        </Block>
      ) : null}

      <Block title={t("assessment.result.limits")}>
        <p>{t("assessment.result.limitsText")}</p>
      </Block>
    </section>
  );
}
