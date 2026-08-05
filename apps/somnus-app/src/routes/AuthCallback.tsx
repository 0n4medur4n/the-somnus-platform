import { zodResolver } from "@hookform/resolvers/zod";
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from "@somnus/api-contracts";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { z } from "zod";
import { completeEmailLinkSignIn, isEmailLink, storedEmail } from "../auth/firebase-auth.js";
import { useAuth } from "../auth/useAuth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { AuthLayout } from "../layouts/AuthLayout.js";
import { edge } from "../lib/edge.js";

type Phase = "verifying" | "register" | "error";

const RegisterSchema = z.object({
  firstName: z.string().min(1, "errors.required"),
  lastName: z.string().min(1, "errors.required"),
});
type RegisterForm = z.infer<typeof RegisterSchema>;

export function AuthCallback() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { state, refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("verifying");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (isEmailLink(window.location.href)) {
          const email = storedEmail() ?? window.prompt(t("login.emailLabel")) ?? "";
          const idToken = await completeEmailLinkSignIn(email, window.location.href);
          await edge.createSession(idToken);
        }
        await refresh();
      } catch {
        setPhase("error");
      }
    })();
  }, [refresh, t]);

  useEffect(() => {
    if (state.status === "authenticated") navigate("/app", { replace: true });
    else if (state.status === "needs-registration") setPhase("register");
    else if (state.status === "unauthenticated" && phase !== "verifying") setPhase("error");
  }, [state.status, navigate, phase]);

  if (phase === "error") {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-semibold">{t("callback.title")}</h1>
        <p role="alert" className="text-somnus-danger">
          {t("callback.error")}
        </p>
      </AuthLayout>
    );
  }

  if (phase === "register") {
    const locale: SupportedLocale = isSupportedLocale(i18n.resolvedLanguage)
      ? i18n.resolvedLanguage
      : DEFAULT_LOCALE;
    return <RegistrationForm locale={locale} onRegistered={() => void refresh()} />;
  }

  return <FullPageStatus message={t("callback.verifying")} />;
}

function RegistrationForm({
  locale,
  onRegistered,
}: {
  locale: SupportedLocale;
  onRegistered: () => void;
}) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(RegisterSchema) });

  const onSubmit = handleSubmit(async ({ firstName, lastName }) => {
    setSubmitError(null);
    try {
      await edge.register({ firstName, lastName, locale });
      onRegistered();
    } catch {
      setSubmitError(t("errors.generic"));
    }
  });

  const firstNameError = errors.firstName
    ? t(errors.firstName.message ?? "errors.generic")
    : undefined;
  const lastNameError = errors.lastName
    ? t(errors.lastName.message ?? "errors.generic")
    : undefined;
  const summary: FieldError[] = [
    ...(firstNameError ? [{ fieldId: "reg-first", message: firstNameError }] : []),
    ...(lastNameError ? [{ fieldId: "reg-last", message: lastNameError }] : []),
  ];

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold">{t("callback.registerTitle")}</h1>
      <p className="text-somnus-muted">{t("callback.registerIntro")}</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <ErrorSummary errors={summary} />
        <Field
          id="reg-first"
          label={t("callback.firstName")}
          autoComplete="given-name"
          {...(firstNameError ? { error: firstNameError } : {})}
          {...register("firstName")}
        />
        <Field
          id="reg-last"
          label={t("callback.lastName")}
          autoComplete="family-name"
          {...(lastNameError ? { error: lastNameError } : {})}
          {...register("lastName")}
        />
        {submitError ? (
          <p role="alert" className="text-somnus-danger">
            {submitError}
          </p>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {t("callback.completeRegistration")}
        </Button>
      </form>
    </AuthLayout>
  );
}
