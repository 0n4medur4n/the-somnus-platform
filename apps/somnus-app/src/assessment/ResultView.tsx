import type { AssessmentContentResponse, AssessmentResult } from "@somnus/api-contracts";
import { useTranslation } from "react-i18next";

type ResultViewProps = {
  result: AssessmentResult;
  content: AssessmentContentResponse;
  complaints: string[];
};

/**
 * Renders the §14b output contract from the deterministic result + the approved
 * artifact wording (build plan §20 Checkpoint 10.3). Every clinical string here
 * comes from the morpheo content endpoint — the SPA never authors clinical
 * text. The "with the information available" framing shows on every L3/L4.
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

  return (
    <section aria-labelledby="assessment-result-heading" className="flex flex-col gap-6">
      <h2 id="assessment-result-heading" className="text-2xl font-semibold">
        {t("assessment.result.title")}
      </h2>

      <div>
        <h3 className="text-lg font-medium">{t("assessment.result.summary")}</h3>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          {routed.map((module) => (
            <li key={module.id}>{module.output}</li>
          ))}
        </ul>
      </div>

      {level ? (
        <div>
          <h3 className="text-lg font-medium">{t("assessment.result.careLevel")}</h3>
          {showFraming ? (
            <p className="mt-1 text-somnus-subtle">{t("assessment.result.framing")}</p>
          ) : null}
          <p className="mt-1 font-medium">{level.name}</p>
          <p>{level.action}</p>
        </div>
      ) : null}

      {routed.length > 0 ? (
        <div>
          <h3 className="text-lg font-medium">{t("assessment.result.patterns")}</h3>
          <ul className="mt-1 flex flex-col gap-2">
            {routed.slice(0, 3).map((module) => {
              const facts = module.entry.filter((phrase) => complaints.includes(phrase));
              return (
                <li key={module.id}>
                  <span className="font-medium">{module.name}</span>
                  {facts.length > 0 ? (
                    <span className="block text-somnus-subtle">
                      {t("assessment.result.triggeredBy", { facts: facts.join(", ") })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-lg font-medium">{t("assessment.result.unknown")}</h3>
        <p className="mt-1">{t("assessment.result.unknownDeferred")}</p>
      </div>

      {routed.length > 0 ? (
        <div>
          <h3 className="text-lg font-medium">{t("assessment.result.prepare")}</h3>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {routed.flatMap((module) =>
              module.minimumQuestions.map((question) => (
                <li key={`${module.id}:${question}`}>{question}</li>
              )),
            )}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="text-lg font-medium">{t("assessment.result.limits")}</h3>
        <p className="mt-1">{t("assessment.result.limitsText")}</p>
      </div>
    </section>
  );
}
