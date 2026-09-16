import type { ContentReviewItem, ReportProvenance } from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * The AI content review queue (Addendum A Checkpoint 15.3, capability
 * `admin_content_review`).
 *
 * Build plan §15: AI-generated health text is not visible to anyone until a
 * human approves it. This screen is that human's only tool, so it shows the two
 * texts side by side — the approved deterministic prose and the candidate — and
 * refuses to record a decision without a reason in either direction.
 *
 * What is deliberately NOT here: any way to see a blocked candidate. A candidate
 * carrying a prohibited claim never enters this queue; the forbidden-phrase
 * scanner discards it before persistence, so it cannot be approved by mistake.
 * The reviewer's job is judgement about wording, not catching what an automated
 * guardrail already prohibits — and the screen says so rather than leaving the
 * absence unexplained.
 */
/**
 * What grounded the deterministic result this candidate paraphrases (16.5).
 *
 * The reviewer's question is whether the candidate says what the approved prose
 * says. This panel adds the second half of that: what the approved prose was
 * itself grounded in — the clinical sources the fired rule cited, and the corpus
 * documents that were rendered beside them.
 *
 * The two lists stay separate here for the same reason they are separate in the
 * report (Addendum B §B3.1): a citation is evidence a rule named, supporting
 * material is background an admin published, and a reviewer judging whether
 * wording is grounded needs to know which is which.
 */
function ProvenancePanel({
  itemId,
  provenance,
}: {
  itemId: string;
  // Explicitly three-valued under `exactOptionalPropertyTypes`: a record, no
  // record, or a queue item that predates the field.
  provenance: ReportProvenance | null | undefined;
}) {
  const { t } = useTranslation();
  const headingId = `provenance-${itemId}`;

  if (!provenance) {
    // Absent, not empty. Saying so is more use to a reviewer than an empty list
    // that reads as "nothing grounded this".
    return (
      <p data-testid={`provenance-missing-${itemId}`} className="text-sm text-somnus-subtle">
        {t("contentReview.provenanceMissing")}
      </p>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`provenance-${itemId}`}
      className="flex flex-col gap-2 rounded-md border border-somnus-border p-3"
    >
      <h4 id={headingId} className="text-sm font-semibold text-somnus-text">
        {t("contentReview.provenanceTitle")}
      </h4>
      <p className="text-xs text-somnus-subtle">{t("contentReview.provenanceIntro")}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-somnus-subtle md:grid-cols-4">
        <dt>{t("contentReview.corpusVersion")}</dt>
        <dd data-testid={`corpus-version-${itemId}`}>{provenance.corpusVersion}</dd>
        <dt>{t("contentReview.contentVersion")}</dt>
        <dd>{provenance.contentVersion}</dd>
      </dl>

      <h5 className="text-xs font-semibold text-somnus-text">
        {t("contentReview.provenanceCitations")}
      </h5>
      {provenance.citations.length === 0 ? (
        <p className="text-xs text-somnus-subtle">{t("contentReview.provenanceNoCitations")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs text-somnus-text">
          {provenance.citations.map((citation) => (
            <li key={citation.sourceId} data-source-id={citation.sourceId}>
              {citation.citation}
            </li>
          ))}
        </ul>
      )}

      <h5 className="text-xs font-semibold text-somnus-text">
        {t("contentReview.provenanceDocuments")}
      </h5>
      {provenance.documents.length === 0 ? (
        <p className="text-xs text-somnus-subtle">{t("contentReview.provenanceNoDocuments")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs text-somnus-text">
          {provenance.documents.map((document) => (
            <li key={document.documentId} data-document-id={document.documentId}>
              {document.title || t("contentReview.provenanceUntitled")}
              {document.corpusVersionAdded != null ? (
                <span className="text-somnus-subtle">
                  {" \u2014 "}
                  {t("contentReview.provenanceAddedIn", { version: document.corpusVersionAdded })}
                </span>
              ) : null}
              {document.retiredSince ? (
                <span data-testid={`retired-${document.documentId}`} className="text-somnus-subtle">
                  {" \u2014 "}
                  {t("contentReview.provenanceRetired")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ContentReviewScreen() {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [items, setItems] = useState<ContentReviewItem[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const queue = await run(() => edge.contentReviewQueue());
    if (queue) setItems(queue.items);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(itemId: string, decision: "approve" | "reject") {
    const reason = (reasons[itemId] ?? "").trim();
    // The contract requires at least 3 characters; refusing here keeps the
    // reviewer from losing their place to a round trip.
    if (reason.length < 3) return;
    const decided = await run(
      () => edge.decideContentReview(itemId, { decision, reason }),
      "contentReview.decided",
    );
    if (decided) await load();
  }

  return (
    <section aria-labelledby="content-review-heading" className="flex flex-col gap-4">
      <h2 id="content-review-heading" className="text-xl font-semibold text-somnus-text">
        {t("contentReview.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("contentReview.intro")}</p>
      <p className="text-sm text-somnus-subtle">{t("contentReview.scannerNote")}</p>

      {error ? (
        <p role="alert" className="text-somnus-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className="text-somnus-success">
          {notice}
        </p>
      ) : null}

      {items && items.length === 0 ? (
        <p className="text-somnus-subtle">{t("contentReview.empty")}</p>
      ) : null}

      <ul className="flex flex-col gap-6">
        {(items ?? []).map((item) => (
          <li
            key={item.itemId}
            className="flex flex-col gap-3 rounded-lg border border-somnus-border p-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <article aria-labelledby={`deterministic-${item.itemId}`}>
                <h3
                  id={`deterministic-${item.itemId}`}
                  className="text-sm font-semibold text-somnus-text"
                >
                  {t("contentReview.deterministic")}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-somnus-text">
                  {item.deterministicText}
                </p>
              </article>
              <article aria-labelledby={`candidate-${item.itemId}`}>
                <h3
                  id={`candidate-${item.itemId}`}
                  className="text-sm font-semibold text-somnus-text"
                >
                  {t("contentReview.candidate")}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-somnus-text">
                  {item.candidateText}
                </p>
              </article>
            </div>

            {/* The §15 generation record, so an approval is traceable to exactly
                which generation was accepted. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-somnus-subtle md:grid-cols-4">
              <dt>{t("contentReview.model")}</dt>
              <dd>{item.modelId}</dd>
              <dt>{t("contentReview.templateVersion")}</dt>
              <dd>{item.promptTemplateVersion}</dd>
              <dt>{t("contentReview.inputHash")}</dt>
              <dd className="font-mono">{item.inputHash.slice(0, 12)}</dd>
              <dt>{t("contentReview.outputHash")}</dt>
              <dd className="font-mono">{item.outputHash.slice(0, 12)}</dd>
            </dl>

            <ProvenancePanel itemId={item.itemId} provenance={item.provenance} />

            <p className="text-sm text-somnus-subtle">{t("contentReview.consequence")}</p>

            <Field
              id={`reason-${item.itemId}`}
              label={t("contentReview.reasonLabel")}
              hint={t("contentReview.reasonHint")}
              value={reasons[item.itemId] ?? ""}
              onChange={(event) =>
                setReasons((current) => ({
                  ...current,
                  [item.itemId]: event.target.value,
                }))
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || (reasons[item.itemId] ?? "").trim().length < 3}
                onClick={() => void decide(item.itemId, "approve")}
              >
                {t("contentReview.approve")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || (reasons[item.itemId] ?? "").trim().length < 3}
                onClick={() => void decide(item.itemId, "reject")}
              >
                {t("contentReview.reject")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
