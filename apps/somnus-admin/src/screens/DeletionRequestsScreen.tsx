import type { AdminDeletionRequest } from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * Right-to-erasure requests (Addendum A Checkpoint 15.2, capability
 * `admin_deletion_requests_process`).
 *
 * Completing one runs the same erasure the person's own `DELETE /v1/me` runs
 * (Checkpoint 13.2): identity data and consent, with the audit trail retained.
 * It cannot be undone, so the screen says that before the button, not after.
 */
export function DeletionRequestsScreen() {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [requests, setRequests] = useState<AdminDeletionRequest[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const list = await run(() => edge.deletionRequests());
    if (list) setRequests(list);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(requestId: string, decision: "complete" | "cancel") {
    const reason = (reasons[requestId] ?? "").trim();
    if (reason.length < 3) return;
    const done = await run(
      () => edge.decideDeletion(requestId, { decision, reason }),
      "deletions.done",
    );
    if (done !== null) await load();
  }

  return (
    <section aria-labelledby="deletions-heading" className="flex flex-col gap-4">
      <h2 id="deletions-heading" className="text-xl font-semibold text-somnus-text">
        {t("deletions.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("deletions.irreversible")}</p>

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

      {requests && requests.length === 0 ? (
        <p className="text-somnus-subtle">{t("deletions.empty")}</p>
      ) : null}

      {requests && requests.length > 0 ? (
        <ul data-testid="deletion-requests" className="flex flex-col gap-4">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/15 bg-somnus-surface p-4"
            >
              <p className="font-mono text-sm text-somnus-text">{request.userId}</p>
              <Field
                id={`deletion-reason-${request.id}`}
                label={t("users.reasonLabel")}
                hint={t("users.reasonHint")}
                value={reasons[request.id] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({ ...current, [request.id]: event.target.value }))
                }
              />
              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={busy || (reasons[request.id] ?? "").trim().length < 3}
                  onClick={() => void decide(request.id, "complete")}
                >
                  {t("deletions.complete")}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busy || (reasons[request.id] ?? "").trim().length < 3}
                  onClick={() => void decide(request.id, "cancel")}
                >
                  {t("deletions.cancel")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
