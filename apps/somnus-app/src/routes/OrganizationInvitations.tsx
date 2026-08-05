import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { z } from "zod";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";
import { useActiveOrg } from "../org/OrgContext.js";

const InviteSchema = z.object({
  email: z.string().min(1, "errors.required").email("errors.invalidEmail"),
});
type InviteForm = z.infer<typeof InviteSchema>;

const AcceptSchema = z.object({ token: z.string().min(1, "errors.required") });
type AcceptForm = z.infer<typeof AcceptSchema>;

export function OrganizationInvitations() {
  const { t } = useTranslation();
  const { activeOrg } = useActiveOrg();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const inviteForm = useForm<InviteForm>({ resolver: zodResolver(InviteSchema) });
  const acceptForm = useForm<AcceptForm>({ resolver: zodResolver(AcceptSchema) });

  const onInvite = inviteForm.handleSubmit(async ({ email }) => {
    setInviteError(null);
    setInviteToken(null);
    if (!activeOrg) return;
    try {
      const result = await edge.invite(activeOrg.id, { email });
      setInviteToken(result.token);
      setInvitedEmail(email);
    } catch {
      setInviteError(t("organization.inviteError"));
    }
  });

  const onAccept = acceptForm.handleSubmit(async ({ token }) => {
    setAcceptError(null);
    setAccepted(false);
    try {
      await edge.acceptInvitation({ token });
      setAccepted(true);
      acceptForm.reset({ token: "" });
    } catch {
      setAcceptError(t("organization.acceptError"));
    }
  });

  const inviteEmailError = inviteForm.formState.errors.email
    ? t(inviteForm.formState.errors.email.message ?? "errors.generic")
    : undefined;
  const inviteSummary: FieldError[] = inviteEmailError
    ? [{ fieldId: "invite-email", message: inviteEmailError }]
    : [];

  const tokenError = acceptForm.formState.errors.token
    ? t(acceptForm.formState.errors.token.message ?? "errors.generic")
    : undefined;
  const acceptSummary: FieldError[] = tokenError
    ? [{ fieldId: "accept-token", message: tokenError }]
    : [];

  return (
    <div className="flex max-w-md flex-col gap-8">
      <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
        <h1 id="invite-heading" className="text-2xl font-semibold">
          {t("organization.invitationsTitle")}
        </h1>
        {activeOrg === null ? (
          <p className="text-somnus-muted">
            <Link to="/organization" className="text-somnus-primary underline">
              {t("organization.title")}
            </Link>
          </p>
        ) : (
          <form onSubmit={onInvite} noValidate className="flex flex-col gap-4">
            <ErrorSummary errors={inviteSummary} />
            <Field
              id="invite-email"
              label={t("organization.inviteEmailLabel")}
              type="email"
              {...(inviteEmailError ? { error: inviteEmailError } : {})}
              {...inviteForm.register("email")}
            />
            {inviteError ? (
              <p role="alert" className="text-somnus-danger">
                {inviteError}
              </p>
            ) : null}
            <Button type="submit" disabled={inviteForm.formState.isSubmitting}>
              {t("organization.invite")}
            </Button>
          </form>
        )}
        {inviteToken ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-somnus-success/40 bg-somnus-success/10 p-3"
          >
            <p>{t("organization.invited", { email: invitedEmail })}</p>
            <code data-testid="invite-token" className="mt-1 block break-all font-mono text-sm">
              {inviteToken}
            </code>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="accept-heading" className="flex flex-col gap-4">
        <h2 id="accept-heading" className="text-xl font-semibold">
          {t("organization.acceptTitle")}
        </h2>
        <form onSubmit={onAccept} noValidate className="flex flex-col gap-4">
          <ErrorSummary errors={acceptSummary} />
          <Field
            id="accept-token"
            label={t("organization.tokenLabel")}
            {...(tokenError ? { error: tokenError } : {})}
            {...acceptForm.register("token")}
          />
          {acceptError ? (
            <p role="alert" className="text-somnus-danger">
              {acceptError}
            </p>
          ) : null}
          {accepted ? (
            <p role="status" aria-live="polite" className="text-somnus-success">
              {t("organization.accepted")}
            </p>
          ) : null}
          <Button type="submit" disabled={acceptForm.formState.isSubmitting}>
            {t("organization.accept")}
          </Button>
        </form>
      </section>
    </div>
  );
}
