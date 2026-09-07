import type { AdminVerificationCase } from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * The professional verification queue (Addendum A Checkpoint 15.2, capability
 * `admin_verification_queue`).
 *
 * §A1: "a professional who self-registers is a normal individual until
 * verified. The verification queue is the only way to become a professional."
 * Approving here is the moment someone becomes able to reach another person's
 * clinical data at all, so the screen says that out loud rather than making it
 * look like clearing a to-do item.
 *
 * A reason is required for BOTH outcomes. An approval with no recorded why is
 * exactly what an audit later cannot question.
 */
export function VerificationScreen() {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [cases, setCases] = useState<AdminVerificationCase[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const queue = await run(() => edge.verificationQueue());
    if (queue) setCases(queue);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(caseId: string, decision: "approve" | "reject") {
    const reason = (reasons[caseId] ?? "").trim();
    // The contract requires at least 3 characters; refusing here keeps the
    // verifier from losing their place to a round trip.
    if (reason.length < 3) return;
    const decided = await run(
      () => edge.decideVerification(caseId, { decision, reason }),
      "verification.decided",
    );
    if (decided) await load();
  }

  return (
    <section aria-labelledby="verification-heading" className="flex flex-col gap-4">
      <h2 id="verification-heading" className="text-xl font-semibold text-somnus-text">
        {t("verification.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("verification.consequence")}</p>

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

      {cases && cases.length === 0 ? (
        <p className="text-somnus-subtle">{t("verification.empty")}</p>
      ) : null}

      {cases && cases.length > 0 ? (
        <ul data-testid="verification-queue" className="flex flex-col gap-4">
          {cases.map((item) => (
            <li
              key={item.caseId}
              className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/15 bg-somnus-surface p-4"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-somnus-subtle">{t("verification.colSpecialty")}</dt>
                <dd className="text-somnus-text">{t(`specialty.${item.specialty}`)}</dd>
                <dt className="text-somnus-subtle">{t("verification.colLicense")}</dt>
                <dd className="font-mono text-somnus-text">{item.licenseNumber}</dd>
              </dl>

              <Field
                id={`reason-${item.caseId}`}
                label={t("verification.reasonLabel")}
                hint={t("verification.reasonHint")}
                value={reasons[item.caseId] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [item.caseId]: event.target.value,
                  }))
                }
              />

              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={busy || (reasons[item.caseId] ?? "").trim().length < 3}
                  onClick={() => void decide(item.caseId, "approve")}
                >
                  {t("verification.approve")}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busy || (reasons[item.caseId] ?? "").trim().length < 3}
                  onClick={() => void decide(item.caseId, "reject")}
                >
                  {t("verification.reject")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
