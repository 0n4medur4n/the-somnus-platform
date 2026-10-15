import type { ConsentPurposeKey, ConsentRecord } from "@somnus/api-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "../components/Button.js";
import { formatDateTime, LegalDocument } from "../components/LegalDocument.js";
import { edge } from "../lib/edge.js";
import { CONSENT_STATUS_QUERY } from "./Assessment.js";

export const CONSENT_RECORDS_QUERY = ["consent-records"] as const;

/**
 * Terms and privacy are the conditions of having an account: leaving them is
 * deleting the account, not a withdrawal. Every other consent can be withdrawn
 * here, effective immediately.
 */
const WITHDRAWABLE: ReadonlySet<ConsentPurposeKey> = new Set([
  "health_data_processing",
  "professional_sharing",
  "marketing",
  "research_participation",
]);

function RecordCard({ record }: { record: ConsentRecord }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const locale = i18n.resolvedLanguage ?? "es";
  const withdrawn = record.withdrawnAt !== undefined;

  const withdraw = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await edge.withdrawConsent(record.receiptId);
      await queryClient.invalidateQueries({ queryKey: CONSENT_RECORDS_QUERY });
      await queryClient.invalidateQueries({ queryKey: CONSENT_STATUS_QUERY });
      setConfirming(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t(`legal.title.${record.purposeKey}`)}</h2>
          <p className="text-sm text-somnus-subtle">
            {t("consents.signedLine", {
              date: formatDateTime(record.consentedAt, locale),
              version: record.document.version,
            })}
          </p>
        </div>
        <span
          className={
            withdrawn
              ? "self-start rounded-full border border-somnus-danger/50 px-3 py-0.5 text-sm text-somnus-danger"
              : "self-start rounded-full border border-somnus-success/50 px-3 py-0.5 text-sm text-somnus-success"
          }
        >
          {withdrawn ? t("consents.status.withdrawn") : t("consents.status.active")}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("consents.hide") : t("consents.view")}
        </Button>
        {!withdrawn && WITHDRAWABLE.has(record.purposeKey) && !confirming ? (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            {t("consents.withdraw")}
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`withdraw-${record.receiptId}`}
          className="flex flex-col gap-3 rounded-xl border border-somnus-danger/50 bg-somnus-danger/10 p-4"
        >
          <p id={`withdraw-${record.receiptId}`}>
            {t(
              record.purposeKey === "health_data_processing"
                ? "consents.confirmHealth"
                : "consents.confirm",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void withdraw()} disabled={busy}>
              {t("consents.confirmWithdraw")}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
          </div>
          {failed ? (
            <p role="alert" className="text-somnus-danger">
              {t("consents.withdrawError")}
            </p>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <LegalDocument
          document={record.document}
          signedAt={record.consentedAt}
          {...(record.withdrawnAt ? { withdrawnAt: record.withdrawnAt } : {})}
        />
      ) : null}
    </li>
  );
}

/**
 * "Mis consentimientos": every consent the person gave, each with the exact
 * text they accepted -- version, date and SHA-256 fingerprint -- to read,
 * print or keep. A withdrawn consent stays listed with when it ended.
 */
export function MyConsents() {
  const { t } = useTranslation();
  const records = useQuery({ queryKey: CONSENT_RECORDS_QUERY, queryFn: edge.getConsentRecords });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/app/profile"
          className="font-medium text-somnus-primary underline-offset-4 hover:underline"
        >
          ← {t("consents.back")}
        </Link>
        <h1 className="text-2xl font-semibold">{t("consents.title")}</h1>
        <p className="text-somnus-subtle">{t("consents.intro")}</p>
      </div>
      {records.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : records.isError ? (
        <p role="alert" className="text-somnus-danger">
          {t("consents.loadError")}
        </p>
      ) : records.data.receipts.length === 0 ? (
        <p>{t("consents.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {records.data.receipts.map((record) => (
            <RecordCard key={record.receiptId} record={record} />
          ))}
        </ul>
      )}
    </div>
  );
}
