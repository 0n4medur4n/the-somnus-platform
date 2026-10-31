import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { sendLoginLink } from "../auth/firebase-auth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { ShellLayout } from "../layouts/ShellLayout.js";

const LoginSchema = z.object({
  email: z.string().min(1, "errors.required").email("errors.invalidEmail"),
});
type LoginForm = z.infer<typeof LoginSchema>;

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

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!isSubmitting) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, [isSubmitting]);

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
    <ShellLayout>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col items-center gap-3 text-center">
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
              <Button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? t("login.sending") : t("login.sendLink")}
              </Button>
              {slow ? (
                <p role="status" aria-live="polite" className="text-sm text-somnus-subtle">
                  {t("login.sendingSlow")}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </ShellLayout>
  );
}
