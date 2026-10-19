import type {
  FunnelExtractionDecisionBody,
  FunnelExtractionItem,
  FunnelStep,
} from "@somnus/api-contracts";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { ChoiceCard } from "../../components/ChoiceCard.js";
import { type AnswerBody, AnswerInput, SubmitLabelContext } from "./StepView.js";

type Decision = FunnelExtractionDecisionBody["decision"];
type Chosen = { decision: Decision; value?: FunnelExtractionDecisionBody["value"] };

/**
 * «Por lo que nos ha contado, entendemos: … ¿Es correcto?» (v0.2 p. 14). What
 * the AI took from the person's own words, one item at a time, each with the
 * words it came from. Nothing is decided for them: every item needs a choice --
 * keep it, correct it (with the question's own answer form), or remove it, in
 * which case it is asked later. Only what they keep or correct counts.
 */
export function ConfirmExtraction({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const items = step.extraction?.items ?? [];
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const complete = items.every((item) => {
    const choice = chosen[item.id];
    return choice !== undefined && (choice.decision !== "corregido" || choice.value != null);
  });
  const send = () =>
    onAnswer({
      decisions: items.map((item) => {
        const choice = chosen[item.id] as Chosen;
        return choice.decision === "corregido"
          ? { id: item.id, decision: choice.decision, value: choice.value ?? null }
          : { id: item.id, decision: choice.decision };
      }),
    });
  const choose = (id: string, choice: Chosen) =>
    setChosen((current) => ({ ...current, [id]: choice }));

  return (
    <section
      aria-labelledby={headingId}
      data-step-key={step.key}
      data-step-type={step.type}
      className="somnus-fade-in flex flex-col gap-5 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5 shadow-lg shadow-black/20 sm:p-7"
    >
      <h2 id={headingId} className="text-lg font-semibold leading-relaxed sm:text-xl">
        {step.text}
      </h2>
      <ol className="flex flex-col gap-4">
        {items.map((item) => (
          <ExtractionItem
            key={item.id}
            item={item}
            question={step.note ?? ""}
            choice={chosen[item.id]}
            busy={busy}
            onChoose={(choice) => choose(item.id, choice)}
          />
        ))}
      </ol>
      <div>
        <Button disabled={busy || !complete} onClick={send}>
          {t("funnel.actions.continue")}
        </Button>
      </div>
    </section>
  );
}

function ExtractionItem({
  item,
  question,
  choice,
  busy,
  onChoose,
}: {
  item: FunnelExtractionItem;
  question: string;
  choice: Chosen | undefined;
  busy: boolean;
  onChoose: (choice: Chosen) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const decisions: Decision[] = item.editable
    ? ["confirmado", "corregido", "quitado"]
    : ["confirmado", "quitado"];
  return (
    <li
      data-item-id={item.id}
      className="flex flex-col gap-3 rounded-xl border border-somnus-muted/30 bg-somnus-surface/60 p-4"
    >
      <p className="text-sm text-somnus-subtle">{item.question}</p>
      <p className="text-base font-medium first-letter:uppercase">{item.answer}</p>
      <p className="text-sm italic text-somnus-subtle">
        {t("funnel.extraction.evidence", { words: item.evidence })}
      </p>
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 font-medium">{question}</legend>
        {decisions.map((decision) => (
          <ChoiceCard
            key={decision}
            type="radio"
            name={name}
            checked={choice?.decision === decision}
            onChange={() => onChoose({ decision })}
            label={t(`funnel.extraction.decisions.${decision}`)}
          />
        ))}
      </fieldset>
      {choice?.decision === "corregido" ? (
        choice.value == null ? (
          <div className="flex flex-col gap-3 border-t border-somnus-muted/30 pt-3">
            <p className="text-sm">{t("funnel.extraction.correctHint")}</p>
            <SubmitLabelContext.Provider value={t("funnel.extraction.saveCorrection")}>
              <AnswerInput
                step={asStep(item)}
                busy={busy}
                onAnswer={(body) => {
                  if (body.value != null) onChoose({ decision: "corregido", value: body.value });
                }}
              />
            </SubmitLabelContext.Provider>
          </div>
        ) : (
          <p className="text-sm text-somnus-primary" role="status">
            {t("funnel.extraction.corrected")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => onChoose({ decision: "corregido" })}
            >
              {t("funnel.actions.change")}
            </button>
          </p>
        )
      ) : null}
      {choice?.decision === "quitado" ? (
        <p className="text-sm text-somnus-subtle" role="status">
          {t("funnel.extraction.removedHint")}
        </p>
      ) : null}
    </li>
  );
}

/** The item's question as a step, so its own answer form can correct it. */
function asStep(item: FunnelExtractionItem): FunnelStep {
  return {
    key: item.id,
    questionId: item.id,
    kind: "ask",
    type: item.type,
    text: item.question,
    note: null,
    options: item.options,
    fields: item.fields,
    noneOption: item.noneOption,
    unit: item.unit,
    units: item.units,
    allowAbsence: false,
    instrument: null,
    phase: "story",
    answeredCount: 0,
    extraction: null,
    panel: null,
  };
}
