import type { FunnelInstrument, FunnelResultPanel, FunnelStepPanel } from "@somnus/api-contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * The team's test panel (internal roles only): why this question was asked,
 * the branches opened, the rules fired, the instruments, the main action and
 * the catalogue phrases used -- the same information as the vignette report.
 * The edge sends it only to staff; this component never decides who sees it.
 */
export function StepPanel({ panel }: { panel: FunnelStepPanel }) {
  const { t } = useTranslation();
  return (
    <Panel>
      <Row label={t("funnel.panel.reason")}>{panel.reason ?? t("funnel.panel.order")}</Row>
      <Row label={t("funnel.panel.source")}>{panel.source}</Row>
      <Row label={t("funnel.panel.branches")}>{list(panel.branchesOpened, t)}</Row>
      <Row label={t("funnel.panel.rules")}>{list(panel.rulesFired, t)}</Row>
      <Row label={t("funnel.panel.mainAction")}>{panel.mainAction ?? t("funnel.panel.none")}</Row>
      <Row label={t("funnel.panel.phrases")}>{list(panel.phraseIds, t)}</Row>
      <Instruments instruments={panel.instruments} />
    </Panel>
  );
}

export function ResultPanel({ panel }: { panel: FunnelResultPanel }) {
  const { t } = useTranslation();
  return (
    <Panel>
      <Row label={t("funnel.panel.branches")}>{list(panel.branchesOpened, t)}</Row>
      <Row label={t("funnel.panel.rules")}>{list(panel.ruleIds, t)}</Row>
      <Row label={t("funnel.panel.orientations")}>
        {panel.orientations.length === 0 ? (
          t("funnel.panel.none")
        ) : (
          <ul className="list-disc pl-5">
            {panel.orientations.map((o) => (
              <li key={`${o.rule}-${o.template ?? o.category}`}>
                {o.rule} · {o.category}
                {o.template ? ` → ${o.template}` : ""} ({o.why})
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label={t("funnel.panel.flags")}>{list(panel.flags, t)}</Row>
      <Row label={t("funnel.panel.pendingData")}>{list(panel.pendingData, t)}</Row>
      <Row label={t("funnel.panel.phrases")}>{list(panel.phraseIds, t)}</Row>
      <Instruments instruments={panel.instruments} />
      <Row label={t("funnel.panel.trace")}>
        <ul className="list-disc pl-5">
          {panel.trace.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Row>
    </Panel>
  );
}

function Instruments({ instruments }: { instruments: FunnelInstrument[] }) {
  const { t } = useTranslation();
  return (
    <Row label={t("funnel.panel.instruments")}>
      {instruments.length === 0 ? (
        t("funnel.panel.none")
      ) : (
        <ul className="list-disc pl-5">
          {instruments.map((instrument) => (
            <li key={instrument.code}>
              {instrument.code}: {t(`funnel.panel.instrumentStatus.${instrument.status}`)}
              {instrument.total !== null ? ` · ${instrument.total} · ${instrument.band ?? ""}` : ""}
              <span className="block text-somnus-subtle">{instrument.placement}</span>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function Panel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <details
      data-testid="team-panel"
      className="rounded-xl border border-dashed border-somnus-primary/50 bg-somnus-primary/5 p-4 text-sm"
    >
      <summary className="cursor-pointer font-medium text-somnus-primary">
        {t("funnel.panel.title")}
      </summary>
      <dl className="mt-3 grid gap-2">{children}</dl>
    </details>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr]">
      <dt className="font-medium text-somnus-subtle">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function list(items: string[], t: (key: string) => string): string {
  return items.length ? items.join(", ") : t("funnel.panel.none");
}
