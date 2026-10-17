import type {
  AssessmentContentResponse,
  AssessmentResult,
  PersonReport,
} from "@somnus/api-contracts";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";
import { activeLocale } from "../i18n/index.js";
import { edge } from "../lib/edge.js";

type ResultViewProps = {
  result: AssessmentResult;
  content: AssessmentContentResponse;
  complaints: string[];
  /** The assessment, when known: its AI-written report is fetched for it. */
  sessionId?: string;
};

/**
 * Each level's accent, from the clinical artifact's own `color` field
 * (L0 red … L4 blue). Presentation only: the level itself and its name come
 * from morpheo.
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

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * The person's result.
 *
 * Two layers, never mixed. The level and the fired safety rules' messages are
 * the protocol's own words (Morpheo's deterministic result), shown first and
 * never written by a model. Around them, the person's report written by the AI
 * from that result (build plan §15 amended 2026-10-16): summary, what to do,
 * patterns, recommendations, what to note for the appointment. An emergency
 * never waits for, nor shows, AI text. If the report cannot be written, the
 * protocol's own wording is shown instead.
 */
export function ResultView({ result, content, complaints, sessionId }: ResultViewProps) {
  const { t } = useTranslation();
  const locale = activeLocale();
  const moduleById = new Map(content.modules.map((module) => [module.id, module]));
  const routed = result.routes
    .map((id) => moduleById.get(id))
    .filter((module): module is NonNullable<typeof module> => module !== undefined);
  const level = result.level
    ? content.safetyLevels.find((safety) => safety.id === result.level)
    : undefined;
  const ruleById = new Map((content.safetyRules ?? []).map((rule) => [rule.id, rule]));
  const urgent = result.triggeredRules
    .map((id) => ruleById.get(id)?.message)
    .filter((message): message is string => message !== undefined);
  const emergency = result.level === "L0";
  const showFraming = result.level === "L3" || result.level === "L4";

  const report = useQuery({
    queryKey: ["person-report", sessionId, locale],
    queryFn: () => edge.getPersonReport(sessionId ?? "", locale),
    enabled: sessionId !== undefined && !emergency && !result.privacyBlock,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const narrative: PersonReport | undefined =
    report.data?.generated && report.data.narrative ? report.data.narrative : undefined;
  const preparing = report.isPending && report.fetchStatus === "fetching";
  // A saved report comes back in well under a second: say "loading". Only a
  // report being written for the first time takes longer -- then say so.
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (!preparing) {
      setWriting(false);
      return;
    }
    const timer = setTimeout(() => setWriting(true), 3000);
    return () => clearTimeout(timer);
  }, [preparing]);

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
      {urgent.length > 0 ? (
        urgent.map((message) => (
          <p key={message} className="text-lg font-medium leading-relaxed">
            {message}
          </p>
        ))
      ) : emergency ? (
        <p className="text-lg font-medium leading-relaxed">{t("assessment.result.emergencyNow")}</p>
      ) : null}
    </section>
  ) : null;

  return (
    <section aria-labelledby="assessment-result-heading" className="flex flex-col gap-4">
      <h2 id="assessment-result-heading" className="text-2xl font-semibold">
        {t("assessment.result.title")}
      </h2>

      {levelCard}

      {preparing ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-somnus-muted/30 bg-somnus-surface/60 p-5"
        >
          <span
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin rounded-full border-2 border-somnus-primary border-t-transparent motion-reduce:animate-none"
          />
          <div className="flex flex-col">
            <span className="font-medium">
              {writing ? t("assessment.result.preparing") : t("assessment.result.loadingReport")}
            </span>
            {writing ? (
              <span className="text-sm text-somnus-subtle">
                {t("assessment.result.preparingHint")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {narrative ? (
        <>
          <Block title={t("assessment.result.summary")}>
            <p className="leading-relaxed">{narrative.summary}</p>
          </Block>
          <Block title={t("assessment.result.whatToDo")}>
            <List items={narrative.whatToDo} />
          </Block>
          {narrative.patterns.length > 0 ? (
            <Block title={t("assessment.result.patterns")}>
              <ul className="flex flex-col gap-3">
                {narrative.patterns.map((pattern) => (
                  <li key={pattern.name} className="flex flex-col">
                    <span className="font-medium">{pattern.name}</span>
                    <span className="leading-relaxed text-somnus-subtle">{pattern.why}</span>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}
          {narrative.recommendations.length > 0 ? (
            <Block title={t("assessment.result.recommendations")}>
              <List items={narrative.recommendations} />
            </Block>
          ) : null}
          {narrative.prepare.length > 0 ? (
            <Block title={t("assessment.result.prepareNotes")}>
              <List items={narrative.prepare} />
            </Block>
          ) : null}
        </>
      ) : !preparing && !emergency && routed.length > 0 ? (
        <>
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
          {level && urgent.length === 0 ? (
            <Block title={t("assessment.result.whatToDo")}>
              <p className="leading-relaxed">{level.action}</p>
            </Block>
          ) : null}
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
        </>
      ) : null}

      <Block title={t("assessment.result.limits")}>
        <p>{t("assessment.result.limitsText")}</p>
      </Block>
    </section>
  );
}
