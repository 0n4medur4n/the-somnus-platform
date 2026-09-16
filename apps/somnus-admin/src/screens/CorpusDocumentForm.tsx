import {
  CORPUS_RIGHTS_STATUSES,
  CORPUS_RIGHTS_WARNING_STATUSES,
  CORPUS_SCOPE_TYPES,
  type CorpusRightsEvidence,
  type CorpusRightsStatus,
  type CorpusScope,
  type CorpusScopeType,
} from "@somnus/api-contracts";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";

/**
 * The one form that creates and edits a reference document (Addendum B §B3 /
 * Checkpoint 16.3).
 *
 * Shared by the corpus screen and the clinical-source enrichment screen on
 * purpose: §B3.1's enrichments are ordinary corpus documents that happen to be
 * scoped to an SRC, so they go through the same rights declaration, the same
 * scope vocabulary and the same warnings. A second, friendlier form for
 * enrichments would be a second place for §B4's questions to be asked less
 * carefully.
 *
 * The form asks for the evidence §B4 requires and warns where the status has a
 * cost outside the platform. It does not decide whether a document may be
 * published: that gate lives in the report service, is the same one the
 * embedding boundary uses, and refuses regardless of what this form believes.
 */

/** Which evidence fields to ASK for, per status. Not a gate — see above. */
export const EVIDENCE_FIELDS: Record<CorpusRightsStatus, Array<keyof CorpusRightsEvidence>> = {
  own_document: [],
  open_access: ["licence", "url"],
  licensed: ["licence", "holder"],
  citation_only: [],
};

/** The corpus is localized like everything else (build plan §3.3). */
export const DOCUMENT_LOCALES = ["es", "en", "ca", "fr"] as const;

export type CorpusFormState = {
  title: string;
  citation: string;
  sourceType: string;
  locale: string;
  rightsStatus: CorpusRightsStatus | "";
  evidence: CorpusRightsEvidence;
  scopes: CorpusScope[];
  text: string;
};

export function emptyCorpusForm(scope?: CorpusScope): CorpusFormState {
  return {
    title: "",
    citation: "",
    sourceType: "guideline",
    locale: "es",
    rightsStatus: "",
    evidence: {},
    scopes: [scope ?? { scopeType: "module", scopeKey: "" }],
    text: "",
  };
}

export function CorpusDocumentForm({
  form,
  editing,
  busy,
  idPrefix,
  lockScopes = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: CorpusFormState;
  editing: boolean;
  busy: boolean;
  /** Distinguishes several instances of this form on one page, for label ids. */
  idPrefix: string;
  /** True where the scope is what the screen is about (§B3.1 enrichments). */
  lockScopes?: boolean;
  onChange: (next: CorpusFormState) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const evidenceFields = form.rightsStatus ? EVIDENCE_FIELDS[form.rightsStatus] : [];
  const warns =
    form.rightsStatus !== "" &&
    (CORPUS_RIGHTS_WARNING_STATUSES as readonly string[]).includes(form.rightsStatus);
  const headingId = `${idPrefix}-form-heading`;

  return (
    <form
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-somnus-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3 id={headingId} className="text-sm font-semibold text-somnus-text">
        {editing ? t("corpus.editTitle") : t("corpus.createTitle")}
      </h3>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          id={`${idPrefix}-title`}
          label={t("corpus.titleLabel")}
          value={form.title}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
        <Field
          id={`${idPrefix}-citation`}
          label={t("corpus.citationLabel")}
          hint={t("corpus.citationHint")}
          value={form.citation}
          onChange={(event) => onChange({ ...form, citation: event.target.value })}
        />
        <Field
          id={`${idPrefix}-source-type`}
          label={t("corpus.sourceTypeLabel")}
          value={form.sourceType}
          onChange={(event) => onChange({ ...form, sourceType: event.target.value })}
        />
        <SelectField
          id={`${idPrefix}-locale`}
          label={t("corpus.localeLabel")}
          hint={t("corpus.localeHint")}
          value={form.locale}
          onChange={(event) => onChange({ ...form, locale: event.target.value })}
          options={DOCUMENT_LOCALES.map((value) => ({ value, label: value }))}
        />
      </div>

      {lockScopes ? (
        <p className="text-sm text-somnus-subtle">
          {t("corpus.scopeLocked", {
            scope: form.scopes.map((scope) => scope.scopeKey).join(", "),
          })}
        </p>
      ) : (
        <ScopeEditor
          idPrefix={idPrefix}
          scopes={form.scopes}
          onChange={(scopes) => onChange({ ...form, scopes })}
        />
      )}

      <fieldset className="flex flex-col gap-3 rounded-md border border-somnus-border p-3">
        <legend className="px-1 text-sm font-semibold text-somnus-text">
          {t("corpus.rightsTitle")}
        </legend>
        <p className="text-sm text-somnus-subtle">{t("corpus.rightsIntro")}</p>
        <SelectField
          id={`${idPrefix}-rights-status`}
          label={t("corpus.rightsLabel")}
          value={form.rightsStatus}
          placeholder={t("corpus.rightsPlaceholder")}
          onChange={(event) =>
            onChange({ ...form, rightsStatus: event.target.value as CorpusRightsStatus | "" })
          }
          options={CORPUS_RIGHTS_STATUSES.map((value) => ({
            value,
            label: t(`corpus.rights.${value}`),
          }))}
        />
        {form.rightsStatus ? (
          <p className="text-sm text-somnus-subtle">
            {t(`corpus.rightsMeaning.${form.rightsStatus}`)}
          </p>
        ) : null}
        {warns ? (
          // §B4: the two statuses whose cost falls outside the platform. Plain
          // language, because the person declaring it is not a lawyer.
          <p role="alert" data-testid={`${idPrefix}-rights-warning`} className="text-somnus-danger">
            {t(`corpus.rightsWarning.${form.rightsStatus}`)}
          </p>
        ) : null}
        {evidenceFields.map((field) => (
          <Field
            key={field}
            id={`${idPrefix}-evidence-${field}`}
            label={t(`corpus.evidence.${field}`)}
            hint={t("corpus.evidenceHint")}
            value={form.evidence[field] ?? ""}
            onChange={(event) =>
              onChange({ ...form, evidence: { ...form.evidence, [field]: event.target.value } })
            }
          />
        ))}
      </fieldset>

      <label htmlFor={`${idPrefix}-text`} className="text-sm font-medium text-somnus-text">
        {t("corpus.textLabel")}
      </label>
      <p id={`${idPrefix}-text-hint`} className="text-sm text-somnus-subtle">
        {t("corpus.textHint")}
      </p>
      <textarea
        id={`${idPrefix}-text`}
        aria-describedby={`${idPrefix}-text-hint`}
        rows={8}
        className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2 text-somnus-text"
        value={form.text}
        onChange={(event) => onChange({ ...form, text: event.target.value })}
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || form.title.trim() === ""}>
          {editing ? t("corpus.save") : t("corpus.create")}
        </Button>
        {editing && onCancel ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {t("corpus.cancelEdit")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ScopeEditor({
  idPrefix,
  scopes,
  onChange,
}: {
  idPrefix: string;
  scopes: CorpusScope[];
  onChange: (next: CorpusScope[]) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-somnus-border p-3">
      <legend className="px-1 text-sm font-semibold text-somnus-text">
        {t("corpus.scopesTitle")}
      </legend>
      <p className="text-sm text-somnus-subtle">{t("corpus.scopesIntro")}</p>
      {scopes.map((scope, index) => (
        <div
          // Scopes are edited in place and have no identity of their own, so
          // the position is the key.
          key={`${idPrefix}-scope-${index}`}
          className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
        >
          <SelectField
            id={`${idPrefix}-scope-type-${index}`}
            label={t("corpus.scopeTypeLabel")}
            value={scope.scopeType}
            onChange={(event) => {
              const next = [...scopes];
              const scopeType = event.target.value as CorpusScopeType;
              // `general` has no key, so choosing it clears whatever was typed
              // rather than storing a key nothing will ever match.
              next[index] = { scopeType, scopeKey: scopeType === "general" ? "" : scope.scopeKey };
              onChange(next);
            }}
            options={CORPUS_SCOPE_TYPES.map((value) => ({
              value,
              label: t(`corpus.scopeType.${value}`),
            }))}
          />
          <Field
            id={`${idPrefix}-scope-key-${index}`}
            label={t("corpus.scopeKeyLabel")}
            hint={t(`corpus.scopeKeyHint.${scope.scopeType}`)}
            value={scope.scopeKey}
            disabled={scope.scopeType === "general"}
            onChange={(event) => {
              const next = [...scopes];
              next[index] = { ...scope, scopeKey: event.target.value };
              onChange(next);
            }}
          />
          {scopes.length > 1 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onChange(scopes.filter((_, at) => at !== index))}
            >
              {t("corpus.removeScope")}
            </Button>
          ) : null}
        </div>
      ))}
      {scopes.some((scope) => scope.scopeType === "general") ? (
        // §B3 allows `general` and expects it to be rare: a document scoped to
        // everything is retrieved for everything.
        <p className="text-sm text-somnus-subtle">{t("corpus.generalScopeNote")}</p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...scopes, { scopeType: "module", scopeKey: "" }])}
        >
          {t("corpus.addScope")}
        </Button>
      </div>
    </fieldset>
  );
}
