import type { AuditQueryRequest, AuditViewRow } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * The audit log viewer (Addendum A §A2.4, capability `admin_audit_read`).
 *
 * `somnus_audit` holds provenance, never a copy of anyone's data, and the worker
 * projects every row through an allowlist before it reaches here — so this screen
 * cannot render a column someone adds to that table later without deciding to.
 *
 * CSV export is a separate capability (`admin_audit_export`, super admin only per
 * §A4). The button is not rendered for anyone else: the server refuses the call
 * regardless, and not offering the control means an admin is never invited into
 * a 403.
 */
export function AuditViewerScreen({ canExport }: { canExport: boolean }) {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [filter, setFilter] = useState<AuditQueryRequest>({});
  const [rows, setRows] = useState<AuditViewRow[] | null>(null);

  function update(key: keyof AuditQueryRequest, value: string) {
    // An empty box is not a filter: dropping the key keeps the request from
    // narrowing on the empty string.
    setFilter((current) => {
      const next = { ...current };
      if (value.trim() === "") delete next[key];
      else Object.assign(next, { [key]: value.trim() });
      return next;
    });
  }

  async function search() {
    const page = await run(() => edge.auditQuery(filter));
    if (page) setRows(page.rows);
  }

  async function exportCsv() {
    const result = await run(() => edge.auditExport(filter));
    if (!result) return;
    // Handed to the browser as a file the admin saves deliberately, rather than
    // rendered into the page where it would just be more unbounded text.
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `somnus-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="audit-heading" className="flex flex-col gap-4">
      <h2 id="audit-heading" className="text-xl font-semibold text-somnus-text">
        {t("audit.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("audit.intro")}</p>

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

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          id="audit-actor"
          label={t("audit.actor")}
          value={filter.actorId ?? ""}
          onChange={(event) => update("actorId", event.target.value)}
        />
        <Field
          id="audit-entity"
          label={t("audit.entity")}
          value={filter.subjectType ?? ""}
          onChange={(event) => update("subjectType", event.target.value)}
        />
        <Field
          id="audit-action"
          label={t("audit.action")}
          value={filter.eventType ?? ""}
          onChange={(event) => update("eventType", event.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="audit-from"
            label={t("audit.from")}
            value={filter.from ?? ""}
            onChange={(event) => update("from", event.target.value)}
          />
          <Field
            id="audit-to"
            label={t("audit.to")}
            value={filter.to ?? ""}
            onChange={(event) => update("to", event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={busy} onClick={() => void search()}>
          {t("audit.search")}
        </Button>
        {canExport ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void exportCsv()}
            >
              {t("audit.exportCsv")}
            </Button>
            <span className="text-xs text-somnus-subtle">{t("audit.exportHint")}</span>
          </>
        ) : null}
      </div>

      {rows && rows.length === 0 ? <p className="text-somnus-subtle">{t("audit.empty")}</p> : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-somnus-subtle">
                <th scope="col">{t("audit.occurredAt")}</th>
                <th scope="col">{t("audit.action")}</th>
                <th scope="col">{t("audit.actor")}</th>
                <th scope="col">{t("audit.entity")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.eventId} className="border-t border-somnus-border">
                  <td className="py-1 whitespace-nowrap">{row.occurredAt}</td>
                  <td className="py-1">{row.eventType}</td>
                  <td className="py-1 font-mono text-xs">{row.actorId ?? "—"}</td>
                  <td className="py-1">{row.subjectType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
