import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { z } from "zod";
import { type CallbackFailure, classifyCallbackFailure } from "../auth/auth-failure.js";
import { completeEmailLinkSignIn, isEmailLink, storedEmail } from "../auth/firebase-auth.js";
import { useNoxAuth } from "../auth/useNoxAuth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { ShellLayout } from "../layouts/ShellLayout.js";

type Phase = "verifying" | "needs-email" | "error";

export function AuthCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refresh } = useNoxAuth();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [failure, setFailure] = useState<CallbackFailure>("generic");
  const started = useRef(false);

  const redeem = useCallback(
    async (email: string, onRecoverable?: (message: string) => void) => {
      try {
        await completeEmailLinkSignIn(email, window.location.href);
        await refresh();
        navigate("/", { replace: true });
      } catch (error) {
        const classified = classifyCallbackFailure(error);
        if (onRecoverable && classified !== "link-invalid") {
          onRecoverable(t("callback.emailMismatch"));
          return;
        }
        setFailure(classified);
        setPhase("error");
      }
    },
    [navigate, refresh, t],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!isEmailLink(window.location.href)) {
      setFailure("generic");
      setPhase("error");
      return;
    }
    const email = storedEmail();
    if (email === null) {
      setPhase("needs-email");
      return;
    }
    void redeem(email);
  }, [redeem]);

  if (phase === "error") {
    return (
      <ShellLayout>
        <h1 className="text-2xl font-semibold text-somnus-text">{t("callback.title")}</h1>
        <p role="alert" className="text-somnus-danger">
          {failure === "link-invalid" ? t("callback.error") : t("callback.errorGeneric")}
        </p>
      </ShellLayout>
    );
  }

  if (phase === "needs-email") return <ConfirmEmailStep onConfirm={redeem} />;
  return <FullPageStatus message={t("callback.verifying")} />;
}

const ConfirmEmailSchema = z.object({
  email: z.string().trim().min(1, "errors.required").email("errors.invalidEmail"),
});
type ConfirmEmailForm = z.infer<typeof ConfirmEmailSchema>;

function ConfirmEmailStep({
  onConfirm,
}: {
  onConfirm: (email: string, onRecoverable: (message: string) => void) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rejected, setRejected] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ConfirmEmailForm>({ resolver: zodResolver(ConfirmEmailSchema) });

  const validationError = errors.email ? t(errors.email.message ?? "errors.generic") : "";
  const fieldError = validationError || rejected || "";
  const summary: FieldError[] = fieldError
    ? [{ fieldId: "callback-email", message: fieldError }]
    : [];

  return (
    <ShellLayout>
      <div className="mx-auto w-full max-w-md rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit(async ({ email }) => {
            setRejected(null);
            await onConfirm(email, setRejected);
          })}
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-somnus-text">{t("callback.emailTitle")}</h1>
            <p className="text-somnus-subtle">{t("callback.emailIntro")}</p>
          </div>
          <ErrorSummary errors={summary} />
          <Field
            id="callback-email"
            label={t("login.emailLabel")}
            hint={t("callback.emailHint")}
            type="email"
            autoComplete="email"
            {...(fieldError ? { error: fieldError } : {})}
            {...register("email")}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {t("callback.emailSubmit")}
          </Button>
        </form>
      </div>
    </ShellLayout>
  );
}
