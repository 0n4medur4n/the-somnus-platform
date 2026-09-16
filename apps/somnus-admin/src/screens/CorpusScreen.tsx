import {
  CORPUS_DOCUMENT_STATUSES,
  CORPUS_SCOPE_TYPES,
  type CorpusDocument,
  type CorpusDocumentStatus,
  type CorpusScopeType,
} from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";
import { edge } from "../lib/edge.js";
import { CorpusDocumentForm, type CorpusFormState, emptyCorpusForm } from "./CorpusDocumentForm.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * Reference-corpus management (Addendum B §B3 / Checkpoint 16.3, capability
 * `admin_corpus_manage`).
 *
 * A document moves draft → published → retired, and that is the whole of its
 * life. **There is no delete control on this screen**, and not because it is
 * hidden from some roles: §B3 has no delete. Retiring keeps the row, which is
 * the only reason a report stamped with an older `corpus_version` can still be
 * explained afterwards. The edge client has no call for it and the API has no
 * route.
 *
 * Which controls appear follows the same rule: a draft can be edited and
 * published, a published document can be retired, and a retired one offers
 * nothing at all — it is history, and history is not edited.
 */
export function CorpusScreen() {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();

  const [documents, setDocuments] = useState<CorpusDocument[] | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CorpusDocumentStatus | "">("");
  const [scopeType, setScopeType] = useState<CorpusScopeType | "">("");
  const [scopeKey, setScopeKey] = useState("");
  const [form, setForm] = useState<CorpusFormState>(() => emptyCorpusForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changelog, setChangelog] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const page = await run(() =>
      edge.searchCorpus({
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(status ? { status } : {}),
        ...(scopeType ? { scopeType } : {}),
        ...(scopeType && scopeKey.trim() ? { scopeKey: scopeKey.trim() } : {}),
      }),
    );
    if (page) {
      setDocuments(page.documents);
      setCurrentVersion(page.currentVersion);
    }
  }, [run, query, status, scopeType, scopeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyCorpusForm());
  }

  async function startEditing(document: CorpusDocument) {
    const detail = await run(() => edge.corpusDocument(document.id));
    if (!detail) return;
    setEditingId(document.id);
    setForm({
      title: detail.document.title,
      citation: detail.document.citation,
      sourceType: detail.document.sourceType,
      locale: detail.document.locale,
      rightsStatus: detail.document.rightsStatus ?? "",
      evidence: detail.document.rightsEvidence,
      scopes:
        detail.document.scopes.length > 0 ? [...detail.document.scopes] : emptyCorpusForm().scopes,
      // The text it is about to replace, so nobody overwrites approved wording
      // they never saw.
      text: detail.chunks.join("\n\n"),
    });
  }

  async function submitForm() {
    const payload = {
      title: form.title.trim(),
      citation: form.citation.trim(),
      sourceType: form.sourceType.trim(),
      locale: form.locale,
      scopes: form.scopes,
      ...(form.rightsStatus ? { rightsStatus: form.rightsStatus } : {}),
      rightsEvidence: form.evidence,
      ...(form.text.trim() ? { text: form.text } : {}),
    };
    const saved = editingId
      ? await run(() => edge.editCorpusDocument(editingId, payload), "corpus.saved")
      : await run(() => edge.createCorpusDocument(payload), "corpus.created");
    if (saved) {
      resetForm();
      await load();
    }
  }

  async function publish(documentId: string) {
    const result = await run(
      () => edge.publishCorpusDocument(documentId, { changelog: changelog.trim() }),
      "corpus.published",
    );
    if (result) {
      setChangelog("");
      await load();
    }
  }

  async function retire(documentId: string) {
    const result = await run(
      () =>
        edge.retireCorpusDocument(documentId, {
          reason: reason.trim(),
          changelog: changelog.trim(),
        }),
      "corpus.retired",
    );
    if (result) {
      setReason("");
      setChangelog("");
      await load();
    }
  }

  return (
    <section aria-labelledby="corpus-heading" className="flex flex-col gap-4">
      <h2 id="corpus-heading" className="text-xl font-semibold text-somnus-text">
        {t("corpus.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("corpus.intro")}</p>
      <p className="text-sm text-somnus-subtle">{t("corpus.noDeleteNote")}</p>
      <p className="text-sm text-somnus-subtle" data-testid="corpus-version">
        {t("corpus.currentVersion", { version: currentVersion })}
      </p>

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

      <form
        aria-labelledby="corpus-search-heading"
        className="flex flex-col gap-3 rounded-lg border border-somnus-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <h3 id="corpus-search-heading" className="text-sm font-semibold text-somnus-text">
          {t("corpus.searchTitle")}
        </h3>
        <div className="grid gap-3 md:grid-cols-4">
          <Field
            id="corpus-query"
            label={t("corpus.queryLabel")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <SelectField
            id="corpus-status-filter"
            label={t("corpus.statusLabel")}
            value={status}
            onChange={(event) => setStatus(event.target.value as CorpusDocumentStatus | "")}
            options={[
              { value: "", label: t("corpus.anyStatus") },
              ...CORPUS_DOCUMENT_STATUSES.map((value) => ({
                value,
                label: t(`corpus.status.${value}`),
              })),
            ]}
          />
          <SelectField
            id="corpus-scope-filter"
            label={t("corpus.scopeTypeLabel")}
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as CorpusScopeType | "")}
            options={[
              { value: "", label: t("corpus.anyScope") },
              ...CORPUS_SCOPE_TYPES.map((value) => ({
                value,
                label: t(`corpus.scopeType.${value}`),
              })),
            ]}
          />
          <Field
            id="corpus-scope-key"
            label={t("corpus.scopeKeyLabel")}
            value={scopeKey}
            onChange={(event) => setScopeKey(event.target.value)}
          />
        </div>
        <div>
          <Button type="submit" disabled={busy}>
            {t("corpus.search")}
          </Button>
        </div>
      </form>

      <CorpusDocumentForm
        idPrefix="corpus"
        form={form}
        editing={editingId !== null}
        busy={busy}
        onChange={setForm}
        onSubmit={() => void submitForm()}
        onCancel={resetForm}
      />

      <section aria-labelledby="corpus-list-heading" className="flex flex-col gap-3">
        <h3 id="corpus-list-heading" className="text-sm font-semibold text-somnus-text">
          {t("corpus.listTitle")}
        </h3>
        {documents && documents.length === 0 ? (
          <p className="text-somnus-subtle">{t("corpus.empty")}</p>
        ) : null}
        <ul className="flex flex-col gap-4">
          {(documents ?? []).map((document) => (
            <li
              key={document.id}
              className="flex flex-col gap-2 rounded-lg border border-somnus-border p-4"
            >
              <CorpusDocumentSummary document={document} />

              {document.status === "draft" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void startEditing(document)}
                  >
                    {t("corpus.edit")}
                  </Button>
                  <Field
                    id={`changelog-${document.id}`}
                    label={t("corpus.changelogLabel")}
                    hint={t("corpus.changelogHint")}
                    value={changelog}
                    onChange={(event) => setChangelog(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={busy || changelog.trim().length < 3}
                    onClick={() => void publish(document.id)}
                  >
                    {t("corpus.publish")}
                  </Button>
                </div>
              ) : null}

              {document.status === "published" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field
                    id={`reason-${document.id}`}
                    label={t("corpus.retireReasonLabel")}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Field
                    id={`retire-changelog-${document.id}`}
                    label={t("corpus.changelogLabel")}
                    value={changelog}
                    onChange={(event) => setChangelog(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || reason.trim().length < 3 || changelog.trim().length < 3}
                    onClick={() => void retire(document.id)}
                  >
                    {t("corpus.retire")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

/** One document's state, shared by the corpus list and the SRC enrichment panels. */
export function CorpusDocumentSummary({ document }: { document: CorpusDocument }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-medium text-somnus-text">{document.title}</h4>
        <span className="text-xs uppercase tracking-wide text-somnus-subtle">
          {t(`corpus.status.${document.status}`)}
        </span>
      </div>
      <p className="text-sm text-somnus-subtle">{document.citation}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-somnus-subtle md:grid-cols-4">
        <dt>{t("corpus.localeLabel")}</dt>
        <dd>{document.locale}</dd>
        <dt>{t("corpus.rightsLabel")}</dt>
        <dd>
          {document.rightsStatus
            ? t(`corpus.rights.${document.rightsStatus}`)
            : t("corpus.rightsUnset")}
        </dd>
        <dt>{t("corpus.chunkCountLabel")}</dt>
        <dd>{document.chunkCount}</dd>
        <dt>{t("corpus.scopesLabel")}</dt>
        <dd>
          {document.scopes
            .map((scope) =>
              scope.scopeKey
                ? `${t(`corpus.scopeType.${scope.scopeType}`)}: ${scope.scopeKey}`
                : t(`corpus.scopeType.${scope.scopeType}`),
            )
            .join(", ")}
        </dd>
        {document.corpusVersionAdded !== null ? (
          <>
            <dt>{t("corpus.versionAddedLabel")}</dt>
            <dd>{document.corpusVersionAdded}</dd>
          </>
        ) : null}
        {document.corpusVersionRetired !== null ? (
          <>
            <dt>{t("corpus.versionRetiredLabel")}</dt>
            <dd>{document.corpusVersionRetired}</dd>
          </>
        ) : null}
      </dl>
      {document.retiredReason ? (
        <p className="text-sm text-somnus-subtle">
          {t("corpus.retiredReason", { reason: document.retiredReason })}
        </p>
      ) : null}
    </>
  );
}
