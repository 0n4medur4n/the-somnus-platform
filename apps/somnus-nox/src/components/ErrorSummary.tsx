import { useTranslation } from "react-i18next";

export type FieldError = { fieldId: string; message: string };

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
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a href={`#${error.fieldId}`} className="text-somnus-danger underline">
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
