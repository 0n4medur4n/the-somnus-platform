import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { sendLoginLink } from "../auth/firebase-auth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { AuthLayout } from "../layouts/AuthLayout.js";

// Messages are i18n keys, translated at render so validation is localized.
const LoginSchema = z.object({
  email: z.string().min(1, "errors.required").email("errors.invalidEmail"),
});
type LoginForm = z.infer<typeof LoginSchema>;

/** Brand mark: a crescent moon (Somnus, the Roman god of sleep). */
function MoonMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 items-center justify-center rounded-2xl bg-somnus-primary-strong/15 text-somnus-primary"
    >
      <svg
        aria-hidden="true"
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </span>
  );
}

export function Login() {
  const { t } = useTranslation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setSubmitError(null);
    try {
      await sendLoginLink(email);
      setSentTo(email);
    } catch {
      setSubmitError(t("login.error"));
    }
  });

  const emailError = errors.email ? t(errors.email.message ?? "errors.generic") : undefined;
  const summary: FieldError[] = emailError ? [{ fieldId: "login-email", message: emailError }] : [];

  return (
    <AuthLayout>
      <div className="flex flex-col items-center gap-3 text-center">
        <MoonMark />
        <h1 className="text-2xl font-semibold text-somnus-text">{t("login.title")}</h1>
        <p className="max-w-sm text-somnus-subtle">{t("login.subtitle")}</p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-somnus-subtle/25 px-3 py-1 text-xs font-medium text-somnus-subtle">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-somnus-success" />
          {t("login.passwordless")}
        </span>
      </div>

      <div className="rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        {sentTo ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-somnus-success/15 text-somnus-success"
            >
              <svg
                aria-hidden="true"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 6 12 13 2 6" />
                <rect x="2" y="4" width="20" height="16" rx="2" />
              </svg>
            </span>
            <p role="status" aria-live="polite" className="text-somnus-text">
              {t("login.linkSent", { email: sentTo })}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSentTo(null);
                setSubmitError(null);
                reset();
              }}
            >
              {t("login.tryAnotherEmail")}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <p className="text-sm text-somnus-subtle">{t("login.intro")}</p>
            <ErrorSummary errors={summary} />
            <Field
              id="login-email"
              label={t("login.emailLabel")}
              hint={t("login.emailHint")}
              type="email"
              autoComplete="email"
              {...(emailError ? { error: emailError } : {})}
              {...register("email")}
            />
            {submitError ? (
              <p role="alert" className="text-somnus-danger">
                {submitError}
              </p>
            ) : null}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {t("login.sendLink")}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
