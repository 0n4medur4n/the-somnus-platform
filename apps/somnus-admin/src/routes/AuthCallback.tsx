import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { z } from "zod";
import { completeEmailLinkSignIn, isEmailLink, storedEmail } from "../auth/firebase-auth.js";
import { useAdminAuth } from "../auth/useAdminAuth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { ConsoleLayout } from "../layouts/ConsoleLayout.js";
import { edge } from "../lib/edge.js";

/**
 * Completes the magic link and exchanges it for a session, then hands over to
 * the gate. There is no registration step here: an admin account is an ordinary
 * Somnus account that a `platform_super_admin` has granted an internal role to
 * (Addendum A §A1), and this console never creates one.
 */

/**
 * The Firebase codes that mean the emailed link itself is unusable.
 *
 * The same two the consumer app's `auth-failure.ts` treats as terminal, and the
 * same reasoning: everything else -- a mistyped address above all -- leaves the
 * link valid and unconsumed, so it is worth another attempt rather than a dead
 * end. Duplicated rather than shared because these are two separate deployables
 * with their own copies of the auth helpers; if a third case appears, both need
 * it.
 */
const LINK_FAILURE_CODES: ReadonlySet<string> = new Set([
  "auth/invalid-action-code",
  "auth/expired-action-code",
]);

function isLinkFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && LINK_FAILURE_CODES.has(code);
}

// Messages are i18n keys, translated at render so validation is localized --
// the same shape the Login screen uses.
const ConfirmEmailSchema = z.object({
  email: z.string().trim().min(1, "errors.required").email("errors.invalidEmail"),
});
type ConfirmEmailForm = z.infer<typeof ConfirmEmailSchema>;

type Phase = "verifying" | "needs-email" | "error";

export function AuthCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, refresh } = useAdminAuth();
  const [phase, setPhase] = useState<Phase>("verifying");
  const started = useRef(false);

  /**
   * Redeem the link, exchange it for a session, hand over to the gate.
   *
   * `onRecoverable` is how the confirmation form keeps someone on the screen for
   * a failure they can fix. A wrong address fails here with a code that is not a
   * link failure, so the honest answer is "check the address" rather than a
   * terminal error for a link that still works.
   */
  const redeem = useCallback(
    async (email: string, onRecoverable?: (message: string) => void) => {
      try {
        const idToken = await completeEmailLinkSignIn(email, window.location.href);
        await edge.createSession(idToken);
        await refresh();
      } catch (error) {
        if (onRecoverable && !isLinkFailure(error)) {
          onRecoverable(t("callback.emailMismatch"));
          return;
        }
        setPhase("error");
      }
    },
    [refresh, t],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (isEmailLink(window.location.href)) {
        const email = storedEmail();
        if (email === null) {
          // Cross-device, or simply a different tab: Firebase requires the
          // address to be re-supplied, and this context's sessionStorage does
          // not have it. Ask for it on a real screen.
          setPhase("needs-email");
          return;
        }
        await redeem(email);
        return;
      }
      try {
        await refresh();
      } catch {
        setPhase("error");
      }
    })();
  }, [redeem, refresh]);

  useEffect(() => {
    // Both outcomes live at the root: the gate decides which one renders.
    if (state.status === "authorized" || state.status === "denied") {
      navigate("/", { replace: true });
    }
  }, [state.status, navigate]);

  if (phase === "error") {
    return (
      <ConsoleLayout>
        <h1 className="text-2xl font-semibold text-somnus-text">{t("callback.title")}</h1>
        <p role="alert" className="text-somnus-danger">
          {t("callback.error")}
        </p>
      </ConsoleLayout>
    );
  }

  if (phase === "needs-email") {
    return <ConfirmEmailStep onConfirm={redeem} />;
  }

  return <FullPageStatus message={t("callback.verifying")} />;
}

/**
 * Cross-device confirmation: the address, asked for on a screen.
 *
 * Firebase requires the email to be re-supplied when a magic link is opened
 * where it was not requested, and this used to be a raw `window.prompt` lifted
 * from Firebase's own example -- a browser dialog titled with the origin, in the
 * browser's language rather than the console's, with no validation and no way
 * back from a typo. The Firebase call underneath is untouched; only the UI
 * asking for the address changed.
 */
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
    <ConsoleLayout>
      <div className="rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
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
            inputMode="email"
            autoComplete="email"
            {...(fieldError ? { error: fieldError } : {})}
            {...register("email")}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {t("callback.emailSubmit")}
          </Button>
        </form>
      </div>
    </ConsoleLayout>
  );
}
