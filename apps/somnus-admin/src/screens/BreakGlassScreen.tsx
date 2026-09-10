import {
  BREAK_GLASS_CATEGORIES,
  BREAK_GLASS_JUSTIFICATION_MIN_LENGTH,
  type BreakGlassCategory,
  type BreakGlassRevealResponse,
} from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * Break-glass access to an individual's clinical record (Addendum A §A2.3 /
 * Checkpoint 15.5, capability `admin_break_glass`).
 *
 * The screen is a justification form that sometimes shows a result, not a
 * viewer with a justification attached to it, and the difference is the whole
 * design. There is no "open record" control that later asks why: the only
 * request this screen can make already carries the reason, so the reveal and
 * the record of it are the same action.
 *
 * Nothing is remembered. The revealed records live in component state and go
 * when the admin leaves the screen; there is no unlock to expire because none
 * was created, and coming back means writing a justification again. The server
 * enforces all of this independently — this screen is the part an admin sees,
 * not the part that decides.
 */
export function BreakGlassScreen() {
  const { t } = useTranslation();
  const { run, busy, error } = useAdminAction();
  const [subjectUserId, setSubjectUserId] = useState("");
  const [category, setCategory] = useState<BreakGlassCategory | "">("");
  const [justification, setJustification] = useState("");
  const [revealed, setRevealed] = useState<BreakGlassRevealResponse | null>(null);

  const remaining = BREAK_GLASS_JUSTIFICATION_MIN_LENGTH - justification.trim().length;
  const ready = subjectUserId.trim() !== "" && category !== "" && remaining <= 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const result = await run(() =>
      edge.breakGlassReveal({
        subjectUserId: subjectUserId.trim(),
        category: category as BreakGlassCategory,
        justification: justification.trim(),
      }),
    );
    if (result) setRevealed(result);
  }

  function close() {
    // Deliberately clears the justification too: the next reveal is a new
    // access and needs its own reason, not the previous one still in the box.
    setRevealed(null);
    setJustification("");
    setCategory("");
  }

  return (
    <section aria-labelledby="break-glass-heading" className="flex flex-col gap-4">
      <h2 id="break-glass-heading" className="text-xl font-semibold text-somnus-text">
        {t("breakGlass.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("breakGlass.intro")}</p>
      <p className="rounded-lg border border-somnus-danger/40 bg-somnus-danger/5 p-3 text-sm text-somnus-text">
        {t("breakGlass.warning")}
      </p>

      {error ? (
        <p role="alert" className="text-somnus-danger">
          {error}
        </p>
      ) : null}

      {revealed ? (
        <RevealedRecords revealed={revealed} onClose={close} />
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
          <Field
            id="break-glass-subject"
            label={t("breakGlass.subjectLabel")}
            hint={t("breakGlass.subjectHint")}
            value={subjectUserId}
            onChange={(event) => setSubjectUserId(event.target.value)}
          />
          <SelectField
            id="break-glass-category"
            label={t("breakGlass.categoryLabel")}
            placeholder={t("breakGlass.categoryPlaceholder")}
            value={category}
            onChange={(event) => setCategory(event.target.value as BreakGlassCategory)}
            options={BREAK_GLASS_CATEGORIES.map((value) => ({
              value,
              label: t(`breakGlass.category.${value}`),
            }))}
          />
          {/* The label element carries the label and nothing else, so the
              field's accessible name is the label -- not the label plus its
              hint plus a live character count. */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="break-glass-justification"
              className="text-sm font-medium text-somnus-text"
            >
              {t("breakGlass.justificationLabel")}
            </label>
            <p id="break-glass-justification-hint" className="text-xs text-somnus-subtle">
              {t("breakGlass.justificationHint", { min: BREAK_GLASS_JUSTIFICATION_MIN_LENGTH })}
            </p>
            <textarea
              id="break-glass-justification"
              aria-describedby="break-glass-justification-hint"
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
              {t("breakGlass.reveal")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function RevealedRecords({
  revealed,
  onClose,
}: {
  revealed: BreakGlassRevealResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm text-somnus-text">
        {t("breakGlass.revealedAt", { at: revealed.revealedAt })}
      </p>
      {/* The admin is told which audit record their access wrote, so they can
          find it in the viewer themselves rather than take it on trust. */}
      <p className="text-xs text-somnus-subtle">
        {t("breakGlass.auditReference", { id: revealed.auditEventId })}
      </p>

      {revealed.snapshots.length === 0 ? (
        <p className="text-somnus-subtle">{t("breakGlass.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {revealed.snapshots.map((snapshot) => (
            <li
              key={snapshot.snapshotId}
              className="rounded-lg border border-somnus-border p-4 flex flex-col gap-1 text-sm"
            >
              <p className="text-somnus-subtle">{snapshot.createdAt}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
                <dt className="text-somnus-subtle">{t("breakGlass.role")}</dt>
                <dd className="text-somnus-text">{snapshot.result.role}</dd>
                <dt className="text-somnus-subtle">{t("breakGlass.level")}</dt>
                <dd className="text-somnus-text">{snapshot.result.level ?? "—"}</dd>
                <dt className="text-somnus-subtle">{t("breakGlass.routes")}</dt>
                <dd className="text-somnus-text">{snapshot.result.routes.join(", ") || "—"}</dd>
                <dt className="text-somnus-subtle">{t("breakGlass.rules")}</dt>
                <dd className="text-somnus-text">
                  {snapshot.result.triggeredRules.join(", ") || "—"}
                </dd>
              </dl>
              <p className="text-xs text-somnus-subtle">
                {t("breakGlass.versions", {
                  workflow: snapshot.workflowVersion,
                  content: snapshot.contentVersion,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("breakGlass.close")}
        </Button>
      </div>
    </div>
  );
}
