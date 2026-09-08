import { forwardRef, type SelectHTMLAttributes, useId } from "react";

export type SelectOption = { value: string; label: string };

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: string;
};

/**
 * Accessible select, same contract as `Field`. The placeholder is a
 * disabled empty-value option so "nothing chosen" is a real state the
 * schema can reject, rather than a silently defaulted first entry.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, options, placeholder, error, hint, id, className, ...selectProps },
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
      <select
        ref={ref}
        id={fieldId}
        defaultValue=""
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={
          className ??
          "rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2 text-somnus-text focus:border-somnus-primary"
        }
        {...selectProps}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-sm text-somnus-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
