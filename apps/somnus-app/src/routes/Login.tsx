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

export function Login() {
  const { t } = useTranslation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
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
      <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
      <p className="text-somnus-muted">{t("login.intro")}</p>
      {sentTo ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-somnus-success/40 bg-somnus-success/10 p-3"
        >
          {t("login.linkSent", { email: sentTo })}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
          <Button type="submit" disabled={isSubmitting}>
            {t("login.sendLink")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
