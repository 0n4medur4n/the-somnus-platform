import type { CorpusDocument, SrcEnrichmentView } from "@somnus/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { CorpusDocumentForm, type CorpusFormState, emptyCorpusForm } from "./CorpusDocumentForm.js";
import { CorpusDocumentSummary } from "./CorpusScreen.js";
import { useAdminAction } from "./useAdminAction.js";

/**
 * Enriching the fifteen clinical sources (Addendum B §B3.1, Checkpoint 16.3).
 *
 * Each SRC entry is shown with the fields the clinical artifact owns — its
 * identifier, citation, `use` and the rules that cite it — rendered read-only
 * and labelled as coming from `morpheo_workflows_v1.json`, because that is where
 * they come from and what the deterministic engine stamps onto a result.
 *
 * The read-only rendering is a courtesy to the reader, not the guarantee. No
 * request shape in the contract carries any of those fields, so no console route
 * can write them; were this file to render them as inputs, there would still be
 * nothing to send them to. What an admin may add is underneath: an ordinary
 * corpus document scoped to this source, which can enrich how the source is
 * explained and can never change which rule fired or what it cited.
 */
export function CorpusSourcesScreen() {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [sources, setSources] = useState<SrcEnrichmentView[] | null>(null);

  const load = useCallback(async () => {
    const page = await run(() => edge.corpusSources());
    if (page) setSources(page.sources);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="corpus-sources-heading" className="flex flex-col gap-4">
      <h2 id="corpus-sources-heading" className="text-xl font-semibold text-somnus-text">
        {t("corpusSources.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("corpusSources.intro")}</p>
      <p className="text-sm text-somnus-subtle">{t("corpusSources.artifactNote")}</p>

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

      <ul className="flex flex-col gap-6">
        {(sources ?? []).map((view) => (
          <li key={view.artifact.id}>
            <SourcePanel view={view} busy={busy} run={run} onChanged={load} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourcePanel({
  view,
  busy,
  run,
  onChanged,
}: {
  view: SrcEnrichmentView;
  busy: boolean;
  run: ReturnType<typeof useAdminAction>["run"];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const scope = { scopeType: "clinical_source", scopeKey: view.artifact.id } as const;
  const [form, setForm] = useState<CorpusFormState>(() => emptyCorpusForm(scope));
  const [open, setOpen] = useState(false);
  const headingId = `src-${view.artifact.id}-heading`;

  async function create() {
    const saved = await run(
      () =>
        edge.createCorpusDocument({
          title: form.title.trim(),
          citation: form.citation.trim(),
          sourceType: form.sourceType.trim(),
          locale: form.locale,
          // Fixed by the panel rather than typed by the admin: an enrichment
          // that drifted onto another source's scope would explain the wrong
          // thing, everywhere that source is cited.
          scopes: [scope],
          ...(form.rightsStatus ? { rightsStatus: form.rightsStatus } : {}),
          rightsEvidence: form.evidence,
          ...(form.text.trim() ? { text: form.text } : {}),
        }),
      "corpus.created",
    );
    if (saved) {
      setForm(emptyCorpusForm(scope));
      setOpen(false);
      await onChanged();
    }
  }

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-somnus-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-medium text-somnus-text">
          {view.artifact.id}
        </h3>
        <span className="text-xs text-somnus-subtle">
          {t("corpusSources.contentVersion", { version: view.contentVersion })}
        </span>
      </div>

      {/* Owned by the clinical artifact. Rendered, never edited (§B3.1). */}
      <dl
        data-testid={`artifact-${view.artifact.id}`}
        className="grid gap-x-4 gap-y-1 text-sm md:grid-cols-[10rem_1fr]"
      >
        <dt className="text-somnus-subtle">{t("corpusSources.citation")}</dt>
        <dd className="text-somnus-text">{view.artifact.citation}</dd>
        <dt className="text-somnus-subtle">{t("corpusSources.url")}</dt>
        <dd className="text-somnus-text">{view.artifact.url}</dd>
        <dt className="text-somnus-subtle">{t("corpusSources.use")}</dt>
        <dd className="text-somnus-text">{view.artifact.use}</dd>
        <dt className="text-somnus-subtle">{t("corpusSources.citedByRules")}</dt>
        <dd className="text-somnus-text">
          {view.artifact.citedByRules.length > 0
            ? view.artifact.citedByRules.join(", ")
            : t("corpusSources.citedByNone")}
        </dd>
      </dl>
      <p className="text-xs text-somnus-subtle">{t("corpusSources.readOnlyNote")}</p>

      <section aria-labelledby={`${headingId}-enrichments`} className="flex flex-col gap-3">
        <h4 id={`${headingId}-enrichments`} className="text-sm font-semibold text-somnus-text">
          {t("corpusSources.enrichmentsTitle")}
        </h4>
        {view.enrichments.length === 0 ? (
          <p className="text-sm text-somnus-subtle">{t("corpusSources.noEnrichments")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {view.enrichments.map((document) => (
              <li
                key={document.id}
                className="flex flex-col gap-2 rounded-md border border-somnus-border p-3"
              >
                <CorpusDocumentSummary document={document} />
                <EnrichmentActions
                  document={document}
                  busy={busy}
                  run={run}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ul>
        )}

        {open ? (
          <CorpusDocumentForm
            idPrefix={`src-${view.artifact.id}`}
            form={form}
            editing={false}
            busy={busy}
            lockScopes
            onChange={setForm}
            onSubmit={() => void create()}
          />
        ) : (
          <div>
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              {t("corpusSources.addEnrichment")}
            </Button>
          </div>
        )}
      </section>
    </article>
  );
}

/**
 * Publish a draft enrichment, or retire a published one.
 *
 * The same two transitions as the corpus screen and no others — there is no
 * delete here either, and a retired enrichment offers nothing at all.
 */
function EnrichmentActions({
  document,
  busy,
  run,
  onChanged,
}: {
  document: CorpusDocument;
  busy: boolean;
  run: ReturnType<typeof useAdminAction>["run"];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [changelog, setChangelog] = useState("");
  const [reason, setReason] = useState("");

  if (document.status === "retired") return null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      {document.status === "published" ? (
        <Field
          id={`enrichment-reason-${document.id}`}
          label={t("corpus.retireReasonLabel")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}
      <Field
        id={`enrichment-changelog-${document.id}`}
        label={t("corpus.changelogLabel")}
        hint={t("corpus.changelogHint")}
        value={changelog}
        onChange={(event) => setChangelog(event.target.value)}
      />
      {document.status === "draft" ? (
        <Button
          type="button"
          disabled={busy || changelog.trim().length < 3}
          onClick={() => {
            void (async () => {
              const result = await run(
                () => edge.publishCorpusDocument(document.id, { changelog: changelog.trim() }),
                "corpus.published",
              );
              if (result) await onChanged();
            })();
          }}
        >
          {t("corpus.publish")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={busy || changelog.trim().length < 3 || reason.trim().length < 3}
          onClick={() => {
            void (async () => {
              const result = await run(
                () =>
                  edge.retireCorpusDocument(document.id, {
                    reason: reason.trim(),
                    changelog: changelog.trim(),
                  }),
                "corpus.retired",
              );
              if (result) await onChanged();
            })();
          }}
        >
          {t("corpus.retire")}
        </Button>
      )}
    </div>
  );
}
