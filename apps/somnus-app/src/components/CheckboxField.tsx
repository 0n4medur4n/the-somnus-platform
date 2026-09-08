import { forwardRef, type InputHTMLAttributes, useId } from "react";

type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string;
  hint?: string;
};

/**
 * Accessible checkbox, same contract as `Field`: a real <label htmlFor>,
 * hint and error wired through aria-describedby, aria-invalid on error.
 * Consent purposes are always rendered as one of these per purpose --
 * never a single combined checkbox (build plan §13).
 */
export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, error, hint, id, className, ...inputProps }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const hintId = `${fieldId}-hint`;
    const errorId = `${fieldId}-error`;
    const describedBy =
      [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") ||
      undefined;

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={
              className ??
              "mt-1 h-4 w-4 shrink-0 rounded border-somnus-muted/40 bg-somnus-surface accent-somnus-primary-strong"
            }
            {...inputProps}
          />
          <label htmlFor={fieldId} className="text-sm text-somnus-text">
            {label}
          </label>
        </div>
        {hint ? (
          <p id={hintId} className="pl-7 text-sm text-somnus-subtle">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="pl-7 text-sm text-somnus-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
