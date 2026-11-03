import {
  FUNNEL_CASE_ACCESS_CATEGORIES,
  FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH,
  type FunnelCase,
  type FunnelCaseAccessCategory,
  type FunnelCaseRecord,
  FunnelResultSchema,
} from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";
import { Badge } from "../components/ui/ui.js";
import { edge } from "../lib/edge.js";
import { useOutcomeLabels } from "./outcome-labels.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * One Morpheo case, opened by its code (ADR 0024, capability
 * `admin_morpheo_case_read`, platform_super_admin alone).
 *
 * Built like break-glass, on purpose: a justification form that sometimes shows
 * a case, never a viewer with a reason attached afterwards. The only request
 * this screen can make already carries the category and the reason, morpheo
 * records the opening before it answers, and the case lives in component state
 * only -- leaving the screen forgets it, and opening it again is a new access.
 *
 * What it shows is what an audit needs: every closure of the interview with the
 * questions as worded and the answers as labelled, what the person was shown,
 * the answers they took back, and every time the case was opened. There is no
 * name, address or account to show: the case has none.
 */
export function MorpheoCasesScreen() {
  const { t } = useTranslation();
  const { run, busy, error } = useAdminAction();
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<FunnelCaseAccessCategory | "">("");
  const [justification, setJustification] = useState("");
  const [opened, setOpened] = useState<FunnelCase | null>(null);

  const remaining = FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH - justification.trim().length;
  const ready = code.trim() !== "" && category !== "" && remaining <= 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const result = await run(() =>
      edge.morpheoCaseOpen({
        caseCode: code.trim(),
        category: category as FunnelCaseAccessCategory,
        justification: justification.trim(),
      }),
    );
    if (result) setOpened(result);
  }

  function close() {
    // The next opening is a new access and needs its own reason.
    setOpened(null);
    setJustification("");
    setCategory("");
  }

  return (
    <section aria-labelledby="morpheo-cases-heading" className="flex flex-col gap-4">
      <h2 id="morpheo-cases-heading" className="text-xl font-semibold text-somnus-text">
        {t("morpheoCases.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("morpheoCases.intro")}</p>
      <p className="rounded-lg border border-somnus-danger/40 bg-somnus-danger/5 p-3 text-sm text-somnus-text">
        {t("morpheoCases.warning")}
      </p>

      {error ? (
        <p role="alert" className="text-somnus-danger">
          {error}
        </p>
      ) : null}

      {opened ? (
        <CaseView opened={opened} onClose={close} />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
          <Field
            id="morpheo-case-code"
            label={t("morpheoCases.codeLabel")}
            hint={t("morpheoCases.codeHint")}
            value={code}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
          />
          <SelectField
            id="morpheo-case-category"
            label={t("breakGlass.categoryLabel")}
            placeholder={t("breakGlass.categoryPlaceholder")}
            value={category}
            onChange={(event) => setCategory(event.target.value as FunnelCaseAccessCategory)}
            options={FUNNEL_CASE_ACCESS_CATEGORIES.map((value) => ({
              value,
              label: t(`breakGlass.category.${value}`),
            }))}
          />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="morpheo-case-justification"
              className="text-sm font-medium text-somnus-text"
            >
              {t("breakGlass.justificationLabel")}
            </label>
            <p id="morpheo-case-justification-hint" className="text-xs text-somnus-subtle">
              {t("breakGlass.justificationHint", { min: FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH })}
            </p>
            <textarea
              id="morpheo-case-justification"
              aria-describedby="morpheo-case-justification-hint"
              rows={4}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              className="rounded-lg border border-somnus-subtle/25 bg-somnus-surface p-2 text-somnus-text"
            />
            {remaining > 0 ? (
              <p aria-live="polite" className="text-xs text-somnus-subtle">
                {t("breakGlass.charactersShort", { count: remaining })}
              </p>
            ) : null}
          </div>
          <div>
            <Button type="submit" disabled={busy || !ready}>
              {t("morpheoCases.open")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function useWhen() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "medium" });
}

function CaseView({ opened, onClose }: { opened: FunnelCase; onClose: () => void }) {
  const { t } = useTranslation();
  const when = useWhen();
  return (
    <div className="flex flex-col gap-4">
      <article
        aria-labelledby="morpheo-case-summary"
        className="flex flex-col gap-2 rounded-lg border border-somnus-border p-4"
      >
        <h3 id="morpheo-case-summary" className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg text-somnus-text">{opened.caseCode}</span>
          <Badge>{t(`morpheoCases.status.${opened.status}`)}</Badge>
        </h3>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-somnus-subtle">{t("morpheoCases.startedAt")}</dt>
          <dd className="text-somnus-text">{when(opened.startedAt)}</dd>
          <dt className="text-somnus-subtle">{t("morpheoCases.closedAt")}</dt>
          <dd className="text-somnus-text">{opened.closedAt ? when(opened.closedAt) : "—"}</dd>
          <dt className="text-somnus-subtle">{t("morpheoCases.versions")}</dt>
          <dd className="text-somnus-text">
            {t("morpheoCases.versionsValue", {
              content: opened.contentVersion,
              rules: opened.rulesVersion,
            })}
          </dd>
        </dl>
        <p className="text-xs text-somnus-subtle">
          {opened.interviewDeleted
            ? t("morpheoCases.interviewDeleted")
            : t("morpheoCases.interviewKept")}
        </p>
      </article>

      {opened.records.length === 0 ? (
        <p className="text-sm text-somnus-subtle">{t("morpheoCases.noRecords")}</p>
      ) : (
        opened.records.map((record, index) => (
          <RecordView
            key={record.recordedAt}
            record={record}
            index={index + 1}
            total={opened.records.length}
          />
        ))
      )}

      <article
        aria-labelledby="morpheo-case-changes"
        className="flex flex-col gap-2 rounded-lg border border-somnus-border p-4"
      >
        <h3 id="morpheo-case-changes" className="text-sm font-semibold text-somnus-text">
          {t("morpheoCases.changesTitle")}
        </h3>
        {opened.changes.length === 0 ? (
          <p className="text-sm text-somnus-subtle">{t("morpheoCases.noChanges")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {opened.changes.map((change) => (
              <li key={change.changedAt} className="flex flex-col gap-1 text-sm">
                <p className="text-somnus-subtle">{when(change.changedAt)}</p>
                <QuestionsAndAnswers items={change.withdrawn} />
              </li>
            ))}
          </ul>
        )}
      </article>

      <article
        aria-labelledby="morpheo-case-accesses"
        className="flex flex-col gap-2 rounded-lg border border-somnus-border p-4"
      >
        <h3 id="morpheo-case-accesses" className="text-sm font-semibold text-somnus-text">
          {t("morpheoCases.accessesTitle")}
        </h3>
        <ul className="flex flex-col gap-2 text-sm">
          {opened.accesses.map((access) => (
            <li key={`${access.accessedAt}-${access.actorId}`} className="flex flex-col">
              <span className="text-somnus-text">
                {when(access.accessedAt)} · {t(`breakGlass.category.${access.category}`)}
              </span>
              <span className="font-mono text-xs text-somnus-subtle">{access.actorId}</span>
              <span className="text-somnus-subtle">«{access.justification}»</span>
            </li>
          ))}
        </ul>
      </article>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button type="button" variant="secondary" onClick={() => window.print()}>
          {t("morpheoCases.print")}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("breakGlass.close")}
        </Button>
      </div>
    </div>
  );
}

function RecordView({
  record,
  index,
  total,
}: {
  record: FunnelCaseRecord;
  index: number;
  total: number;
}) {
  const { t } = useTranslation();
  const when = useWhen();
  const labels = useOutcomeLabels();
  // Stored as it was shown. Read with today's contract when it still fits;
  // otherwise shown raw, never dropped -- an old record must stay readable.
  const parsed = FunnelResultSchema.safeParse(record.result);
  const headingId = `morpheo-case-record-${index}`;
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-somnus-border p-4"
    >
      <h3 id={headingId} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className="text-somnus-text">{t("morpheoCases.recordTitle", { index, total })}</span>
        <Badge>{t(`morpheoCases.status.${record.status}`)}</Badge>
        <span className="font-normal text-somnus-subtle">{when(record.recordedAt)}</span>
      </h3>
      {record.reconstructed ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-somnus-text">
          {t("morpheoCases.reconstructed")}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-somnus-subtle">
          {t("morpheoCases.shownTitle")}
        </h4>
        {parsed.success ? (
          <div className="flex flex-col gap-2 text-sm">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              <dt className="text-somnus-subtle">{t("morpheoCases.mainAction")}</dt>
              <dd className="text-somnus-text">
                {parsed.data.mainAction ? labels.mainAction(parsed.data.mainAction) : "—"}
              </dd>
              <dt className="text-somnus-subtle">{t("morpheoCases.alerts")}</dt>
              <dd className="text-somnus-text">
                {parsed.data.alerts.map((a) => labels.mainAction(a)).join(", ") || "—"}
              </dd>
              {parsed.data.stoppedBy ? (
                <>
                  <dt className="text-somnus-subtle">{t("morpheoCases.stoppedBy")}</dt>
                  <dd className="font-mono text-somnus-text">{parsed.data.stoppedBy}</dd>
                </>
              ) : null}
            </dl>
            {parsed.data.texts.map((text) => (
              <blockquote
                key={`${text.template}-${text.text.slice(0, 24)}`}
                className="border-l-2 border-somnus-primary/50 pl-3 text-somnus-text"
              >
                <p className="text-xs text-somnus-subtle">
                  {text.template ? labels.template(text.template) : ""}
                </p>
                <p>{text.text}</p>
              </blockquote>
            ))}
            {parsed.data.report?.headline.length ? (
              <p className="text-somnus-text">
                <span className="text-somnus-subtle">{t("morpheoCases.reportHeadline")}: </span>
                {parsed.data.report.headline.join(" ")}
              </p>
            ) : null}
          </div>
        ) : (
          <pre className="max-h-80 overflow-auto rounded bg-black/20 p-2 text-xs text-somnus-text">
            {JSON.stringify(record.result, null, 2)}
          </pre>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-somnus-subtle">
          {t("morpheoCases.answersTitle", { count: record.history.length })}
        </h4>
        <QuestionsAndAnswers items={record.history} />
      </div>
    </article>
  );
}

function QuestionsAndAnswers({
  items,
}: {
  items: ReadonlyArray<{ key: string; question: string; answer: string }>;
}) {
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col">
          <span className="text-somnus-subtle">
            <span className="font-mono text-xs">{item.key}</span> · {item.question}
          </span>
          <span className="text-somnus-text">{item.answer || "—"}</span>
        </li>
      ))}
    </ol>
  );
}
