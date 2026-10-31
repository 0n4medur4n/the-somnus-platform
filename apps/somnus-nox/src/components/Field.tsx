import { forwardRef, type InputHTMLAttributes, useId } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, className, ...inputProps },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy =
    [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-somnus-text">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-somnus-subtle">
          {hint}
        </p>
      ) : null}
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={
          className ??
          "rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2 text-somnus-text placeholder:text-somnus-subtle focus:border-somnus-primary"
        }
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-sm text-somnus-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
