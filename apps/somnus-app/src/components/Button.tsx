import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

/**
 * A real <button> (never a clickable div), keyboard-operable by
 * default, with an explicit `type` so it never accidentally submits a
 * form. Contrast meets the a11y baseline against the dark surface.
 */
export function Button({ variant = "primary", className, type, ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? // primary-strong (#2f6ae0) clears WCAG AA for white text (~4.9:1);
        // the base --somnus-primary (#437ef7) is ~3.9:1 and fails.
        "bg-somnus-primary-strong text-white hover:brightness-110"
      : "border border-somnus-subtle/50 bg-transparent text-somnus-text hover:bg-somnus-surface";
  return <button type={type ?? "button"} className={twMerge(base, styles, className)} {...props} />;
}
