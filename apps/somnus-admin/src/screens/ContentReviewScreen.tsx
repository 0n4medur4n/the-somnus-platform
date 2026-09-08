import type { ContentReviewItem } from "@somnus/api-contracts";
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
