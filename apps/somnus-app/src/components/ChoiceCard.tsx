import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { twMerge } from "tailwind-merge";

type ChoiceCardProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  type: "radio" | "checkbox";
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
};

/**
 * A large, touch-friendly option. It is still a real radio or checkbox inside
 * its <label> -- keyboard, screen readers and `getByLabel` all see the native
 * control -- only the presentation is a card. The check mark and the selected
 * border are not the only signal: the control's own checked state is announced.
 */
export function ChoiceCard({ type, label, hint, className, ...input }: ChoiceCardProps) {
  // The control is named by the label alone and described by the hint, so a
  // screen reader says "Adulto, para mí" and then the explanation -- not one
  // long run-on name.
  const labelId = useId();
  const hintId = useId();
  return (
    <label
      className={twMerge(
        "group relative flex cursor-pointer items-start gap-3 rounded-xl border border-somnus-muted/40 bg-somnus-surface/60 p-4 transition-colors",
        "hover:border-somnus-primary/60 has-[:checked]:border-somnus-primary has-[:checked]:bg-somnus-primary/10",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-somnus-primary",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        className,
      )}
    >
      {/* The real control, transparent, covers the whole card: a tap anywhere on
          it is a tap on the input itself -- for people, assistive tech and
          automated clicks alike. */}
      <input
        type={type}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-xl opacity-0 disabled:cursor-not-allowed"
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        {...input}
      />
      <span
        aria-hidden="true"
        className={twMerge(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2 border-somnus-subtle/70 text-[0.7rem] font-bold text-white",
          type === "radio" ? "rounded-full" : "rounded-md",
          "peer-checked:border-somnus-primary-strong peer-checked:bg-somnus-primary-strong",
        )}
      >
        <span className="hidden group-has-[:checked]:inline">✓</span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className="font-medium leading-snug first-letter:uppercase">
          {label}
        </span>
        {hint ? (
          <span id={hintId} className="text-sm text-somnus-subtle">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Three-way answers (Sí / No / No lo sé) as one segmented control: a radio
 * group whose options are pill-shaped and sit side by side.
 */
export function SegmentedOption({
  label,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; className?: string }) {
  return (
    <label
      className={twMerge(
        "relative flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-lg border border-somnus-muted/40 px-3 py-2.5 text-center text-sm font-medium transition-colors",
        "hover:border-somnus-primary/60 has-[:checked]:border-somnus-primary-strong has-[:checked]:bg-somnus-primary-strong has-[:checked]:text-white",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-somnus-primary",
        className,
      )}
    >
      <input
        type="radio"
        className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-lg opacity-0"
        {...input}
      />
      {label}
    </label>
  );
}
