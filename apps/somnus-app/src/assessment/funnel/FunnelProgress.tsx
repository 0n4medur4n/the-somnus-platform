import type { FunnelPhase } from "@somnus/api-contracts";
import { useTranslation } from "react-i18next";

/** The interview's parts, as the person sees them; an instrument belongs to "Detalles". */
const PARTS = ["start", "story", "branches", "protection", "closing", "result"] as const;
type Part = (typeof PARTS)[number];

function partOf(phase: FunnelPhase | "result"): Part {
  return phase === "instrument" ? "branches" : phase;
}

/**
 * Where the person is. The number of questions depends on their answers (the
 * branches open or not), so the indicator shows the part of the interview and
 * how many answers are given, never a count that could jump backwards.
 */
export function FunnelProgress({
  phase,
  answered,
}: {
  phase: FunnelPhase | "result";
  answered: number;
}) {
  const { t } = useTranslation();
  const current = PARTS.indexOf(partOf(phase));
  return (
    <nav aria-label={t("funnel.progress.label")} className="flex flex-col gap-2">
      <ol className="grid grid-cols-6 gap-1.5">
        {PARTS.map((part, index) => (
          <li key={part} className="flex flex-col gap-1">
            <span
              aria-hidden="true"
              className={`h-1.5 rounded-full ${index <= current ? "bg-somnus-primary" : "bg-somnus-muted/40"}`}
            />
            <span
              className={`hidden text-xs sm:block ${index === current ? "font-medium text-somnus-text" : "text-somnus-subtle"}`}
              aria-current={index === current ? "step" : undefined}
            >
              {t(`funnel.progress.parts.${part}`)}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-somnus-subtle" aria-live="polite">
        {t("funnel.progress.now", {
          part: t(`funnel.progress.parts.${PARTS[current] ?? "start"}`),
          count: answered,
        })}
      </p>
    </nav>
  );
}
