import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", className, type, ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-somnus-primary-strong text-white hover:brightness-110"
      : "border border-somnus-subtle/50 bg-transparent text-somnus-text hover:bg-somnus-surface";
  return <button type={type ?? "button"} className={twMerge(base, styles, className)} {...props} />;
}
