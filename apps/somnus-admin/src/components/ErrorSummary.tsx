import { useTranslation } from "react-i18next";

export type FieldError = { fieldId: string; message: string };

/**
 * A focusable error summary (build plan §20 9.1 a11y baseline: "error
 * summaries"). role="alert" announces it to screen readers; each item
 * links to the offending field so keyboard users jump straight to it.
 * Render only when there are errors.
 */
export function ErrorSummary({ errors }: { errors: FieldError[] }) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      className="rounded-md border border-somnus-danger/50 bg-somnus-danger/10 p-3"
    >
      <p className="font-medium text-somnus-danger">{t("errors.summaryTitle")}</p>
      <ul className="mt-1 list-disc pl-5">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a href={`#${e.fieldId}`} className="text-somnus-danger underline">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
