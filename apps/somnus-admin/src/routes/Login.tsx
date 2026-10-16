import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { sendLoginLink } from "../auth/firebase-auth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { ConsoleLayout } from "../layouts/ConsoleLayout.js";

// Messages are i18n keys, translated at render so validation is localized.
const LoginSchema = z.object({
  email: z.string().min(1, "errors.required").email("errors.invalidEmail"),
});
type LoginForm = z.infer<typeof LoginSchema>;

/**
 * The same magic link as the consumer app (Addendum A Checkpoint 15.1: "Login
 * via the same magic link"). Authentication is shared; authorization is not --
 * anyone can obtain a session here, and only an internal role gets past the
 * gate. So this screen must not imply eligibility: it never says who may enter,
 * and sending a link to a non-admin is not an error, it simply ends at the
 * denial screen.
 */
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

  // A first request after a quiet spell can take a few seconds: say so, rather
  // than leave a button that looks stuck.
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
    <ConsoleLayout>
      <div className="rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        <h1 className="text-2xl font-semibold text-somnus-text">{t("login.title")}</h1>
        <p className="mt-1 text-somnus-subtle">{t("login.subtitle")}</p>

        {sentTo ? (
          <div className="mt-6 flex flex-col items-start gap-4">
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
          <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
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
              className="w-full gap-2"
            >
              {isSubmitting ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  />
                  {t("login.sending")}
                </>
              ) : (
                t("login.sendLink")
              )}
            </Button>
            {slow ? (
              <p role="status" aria-live="polite" className="text-sm text-somnus-subtle">
                {t("login.sendingSlow")}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </ConsoleLayout>
  );
}
