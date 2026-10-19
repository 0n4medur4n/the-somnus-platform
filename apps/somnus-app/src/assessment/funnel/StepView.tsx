import {
  FREE_TEXT_MAX_LENGTH,
  type FunnelAbsence,
  type FunnelAnswerRequest,
  type FunnelStep,
  findIdentifyingData,
} from "@somnus/api-contracts";
import { createContext, type FormEvent, useContext, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { ChoiceCard } from "../../components/ChoiceCard.js";
import { ConfirmExtraction } from "./ConfirmExtraction.js";

export type AnswerBody = Omit<FunnelAnswerRequest, "key">;

const NONE = "ninguna";

/** The answer form's button label, when it is not "Continuar" (a correction's "Guardar"). */
export const SubmitLabelContext = createContext<string | null>(null);

type StepViewProps = {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
  /** Z1 "No": the person wants to correct an answer. */
  onCorrect: () => void;
};

/**
 * One step of the v2 interview, exactly as the engine serves it. The question
 * text, the options and their order come from morpheo (v0.2 word for word, an
 * approved text, or an official instrument); the app only lays them out and
 * sends back the answer to this step. "No lo sé" and "Prefiero no responder"
 * are always there where the step allows them (R03: unknown is never "No").
 */
export function StepView({ step, busy, onAnswer, onCorrect }: StepViewProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const isZ1 = step.questionId === "Z1";

  if (step.kind === "confirm_extraction") {
    return <ConfirmExtraction step={step} busy={busy} onAnswer={onAnswer} />;
  }
  return (
    <section
      aria-labelledby={headingId}
      data-step-key={step.key}
      data-step-type={step.type}
      className="somnus-fade-in flex flex-col gap-5 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5 shadow-lg shadow-black/20 sm:p-7"
    >
      {step.instrument ? (
        <p className="text-sm font-medium uppercase tracking-wide text-somnus-subtle">
          {step.instrument.name}
        </p>
      ) : null}
      <h2
        id={headingId}
        className="whitespace-pre-line text-lg font-semibold leading-relaxed sm:text-xl"
      >
        {step.text}
      </h2>
      {isZ1 ? (
        <YesNo
          yesLabel={t("funnel.actions.correct")}
          noLabel={t("funnel.actions.fix")}
          busy={busy}
          onYes={() => onAnswer({ value: "si" })}
          onNo={onCorrect}
        />
      ) : (
        <AnswerInput step={step} busy={busy} onAnswer={onAnswer} />
      )}
      {step.allowAbsence && !isZ1 && step.kind !== "instrument_intro" ? (
        <Absences busy={busy} onAnswer={onAnswer} />
      ) : null}
    </section>
  );
}

/** The answer form for a step's type (also used to correct an item the AI proposed). */
export function AnswerInput({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const { t } = useTranslation();
  if (step.kind === "info") {
    return (
      <div>
        <Button disabled={busy} onClick={() => onAnswer({ value: "visto" })}>
          {t("funnel.actions.continue")}
        </Button>
      </div>
    );
  }
  if (step.kind === "confirm") {
    return (
      <YesNo
        yesLabel={t("funnel.actions.same")}
        noLabel={t("funnel.actions.changed")}
        busy={busy}
        onYes={() => onAnswer({ value: "sigue_igual" })}
        onNo={() => onAnswer({ value: "ha_cambiado" })}
      />
    );
  }
  if (step.kind === "instrument_intro") {
    return (
      <YesNo
        yesLabel={t("funnel.actions.answerInstrument")}
        noLabel={t("funnel.actions.skipInstrument")}
        busy={busy}
        onYes={() => onAnswer({ value: "si" })}
        onNo={() => onAnswer({ value: "no" })}
      />
    );
  }
  switch (step.type) {
    case "yes_no":
      return (
        <YesNo
          yesLabel={t("funnel.actions.yes")}
          noLabel={t("funnel.actions.no")}
          busy={busy}
          onYes={() => onAnswer({ value: "si" })}
          onNo={() => onAnswer({ value: "no" })}
        />
      );
    case "yes_no_note":
      return <YesNoNote busy={busy} onAnswer={onAnswer} />;
    case "number":
      return <NumberAnswer step={step} busy={busy} onAnswer={onAnswer} />;
    case "free_text":
      return <FreeText busy={busy} onAnswer={onAnswer} />;
    case "duration":
      return <Duration step={step} busy={busy} onAnswer={onAnswer} />;
    case "times":
      return <Times step={step} busy={busy} onAnswer={onAnswer} />;
    case "multi":
      return <Multi step={step} busy={busy} onAnswer={onAnswer} />;
    default:
      return <Single step={step} busy={busy} onAnswer={onAnswer} />;
  }
}

function YesNo({
  yesLabel,
  noLabel,
  busy,
  onYes,
  onNo,
}: {
  yesLabel: string;
  noLabel: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Button disabled={busy} onClick={onYes} className="py-3 text-base">
        {yesLabel}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onNo} className="py-3 text-base">
        {noLabel}
      </Button>
    </div>
  );
}

function Absences({ busy, onAnswer }: { busy: boolean; onAnswer: (body: AnswerBody) => void }) {
  const { t } = useTranslation();
  const absent = (absence: FunnelAbsence) => () => onAnswer({ absence });
  return (
    <div className="flex flex-wrap gap-3 border-t border-somnus-muted/30 pt-4">
      <Button variant="secondary" disabled={busy} onClick={absent("no_lo_se")}>
        {t("funnel.actions.unknown")}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={absent("prefiero_no_responder")}>
        {t("funnel.actions.prefer")}
      </Button>
    </div>
  );
}

function Submit({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  const { t } = useTranslation();
  const label = useContext(SubmitLabelContext);
  return (
    <div>
      <Button type="submit" disabled={busy || disabled}>
        {label ?? t("funnel.actions.continue")}
      </Button>
    </div>
  );
}

function useSubmit(send: () => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    send();
  };
}

/** Free text and notes: refuse an email, a phone or a DNI/NIE before it is sent. */
function TextArea({
  value,
  onChange,
  label,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const warning = findIdentifyingData(value).length > 0;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={FREE_TEXT_MAX_LENGTH}
        rows={5}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
        className="w-full rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-base"
      />
      <p
        id={`${id}-hint`}
        className={warning ? "text-somnus-danger" : "text-sm text-somnus-subtle"}
        role={warning ? "alert" : undefined}
      >
        {warning ? t("funnel.text.identifying") : t("funnel.text.hint")}
      </p>
    </div>
  );
}

function FreeText({ busy, onAnswer }: { busy: boolean; onAnswer: (body: AnswerBody) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const blocked = text.trim().length === 0 || findIdentifyingData(text).length > 0;
  const submit = useSubmit(() => onAnswer({ value: text.trim() }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextArea value={text} onChange={setText} label={t("funnel.text.label")} required />
      <Submit busy={busy} disabled={blocked} />
    </form>
  );
}

function YesNoNote({ busy, onAnswer }: { busy: boolean; onAnswer: (body: AnswerBody) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<"si" | "no" | null>(null);
  const [note, setNote] = useState("");
  const blocked = value === null || findIdentifyingData(note).length > 0;
  const submit = useSubmit(() => {
    if (value === null) return;
    const text = note.trim();
    onAnswer(text ? { value, text } : { value });
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t("funnel.actions.yes")}</legend>
        {(["si", "no"] as const).map((option) => (
          <ChoiceCard
            key={option}
            type="radio"
            name="yes-no"
            checked={value === option}
            onChange={() => setValue(option)}
            label={option === "si" ? t("funnel.actions.yes") : t("funnel.actions.no")}
          />
        ))}
      </fieldset>
      {value === "si" ? (
        <TextArea
          value={note}
          onChange={setNote}
          label={t("funnel.text.noteLabel")}
          required={false}
        />
      ) : null}
      <Submit busy={busy} disabled={blocked} />
    </form>
  );
}

function NumberAnswer({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const id = useId();
  const [raw, setRaw] = useState("");
  const value = Number(raw);
  const valid = raw.trim() !== "" && Number.isInteger(value) && value >= 0;
  const submit = useSubmit(() => onAnswer({ value }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          aria-label={step.unit ?? step.text}
          className="w-32 rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-lg"
        />
        {step.unit ? <span className="text-somnus-subtle">{step.unit}</span> : null}
      </div>
      <Submit busy={busy} disabled={!valid} />
    </form>
  );
}

function Duration({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const [unit, setUnit] = useState(step.units[0] ?? "");
  const value = Number(raw.replace(",", "."));
  const valid = raw.trim() !== "" && Number.isFinite(value) && value > 0 && unit !== "";
  const submit = useSubmit(() => onAnswer({ value: { value, unit } }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          aria-label={t("funnel.duration.amount")}
          className="w-28 rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-lg"
        />
        {step.units.length > 1 ? (
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            aria-label={t("funnel.duration.unit")}
            className="rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-base"
          >
            {step.units.map((option) => (
              <option key={option} value={option}>
                {t(`funnel.units.${option}`)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-somnus-subtle">{t(`funnel.units.${unit}`)}</span>
        )}
      </div>
      <Submit busy={busy} disabled={!valid} />
    </form>
  );
}

function Times({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const [times, setTimes] = useState<Record<string, string>>({});
  const valid = step.fields.every((field) => /^\d{2}:\d{2}$/.test(times[field.key] ?? ""));
  const submit = useSubmit(() => onAnswer({ value: times }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {step.fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="font-medium first-letter:uppercase">{field.label}</span>
            <input
              type="time"
              value={times[field.key] ?? ""}
              onChange={(event) =>
                setTimes((current) => ({ ...current, [field.key]: event.target.value }))
              }
              className="w-36 rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-lg"
            />
          </label>
        ))}
      </div>
      <Submit busy={busy} disabled={!valid} />
    </form>
  );
}

function Multi({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string[]>([]);
  const [none, setNone] = useState(false);
  const submit = useSubmit(() => onAnswer({ value: none ? [] : chosen }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="grid gap-3">
        <legend className="sr-only">{step.text}</legend>
        {step.options.map((option) => (
          <ChoiceCard
            key={option.key}
            type="checkbox"
            checked={chosen.includes(option.key)}
            onChange={() => {
              setNone(false);
              setChosen((current) =>
                current.includes(option.key)
                  ? current.filter((key) => key !== option.key)
                  : [...current, option.key],
              );
            }}
            label={<span className="first-letter:uppercase">{option.label}</span>}
          />
        ))}
        {step.noneOption ? (
          <ChoiceCard
            type="checkbox"
            checked={none}
            onChange={() => {
              setNone((current) => !current);
              setChosen([]);
            }}
            label={t("funnel.actions.none")}
          />
        ) : null}
      </fieldset>
      <Submit busy={busy} disabled={!none && chosen.length === 0} />
    </form>
  );
}

function Single({
  step,
  busy,
  onAnswer,
}: {
  step: FunnelStep;
  busy: boolean;
  onAnswer: (body: AnswerBody) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const options = step.noneOption
    ? [...step.options, { key: NONE, label: t("funnel.actions.none") }]
    : step.options;
  const submit = useSubmit(() => {
    if (chosen !== null) onAnswer({ value: chosen });
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="grid gap-3">
        <legend className="sr-only">{step.text}</legend>
        {options.map((option) => (
          <ChoiceCard
            key={option.key}
            type="radio"
            name={name}
            checked={chosen === option.key}
            onChange={() => setChosen(option.key)}
            label={<span className="first-letter:uppercase">{option.label}</span>}
          />
        ))}
      </fieldset>
      <Submit busy={busy} disabled={chosen === null} />
    </form>
  );
}
