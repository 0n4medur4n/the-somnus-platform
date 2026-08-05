import { zodResolver } from "@hookform/resolvers/zod";
import { OrganizationCreateRequestSchema } from "@somnus/api-contracts";
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

// Local form schema with i18n-key messages; the wire contract
// (OrganizationCreateRequestSchema) still validates the payload we send.
const OrgFormSchema = z.object({ name: z.string().min(1, "errors.required") });
type OrgForm = z.infer<typeof OrgFormSchema>;

export function Organization() {
  const { t } = useTranslation();
  const { activeOrg, setActiveOrg } = useActiveOrg();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OrgForm>({ resolver: zodResolver(OrgFormSchema) });

  const onSubmit = handleSubmit(async ({ name }) => {
    setSubmitError(null);
    try {
      const payload = OrganizationCreateRequestSchema.parse({ name });
      const org = await edge.createOrganization(payload);
      setActiveOrg({ id: org.id, name: org.name });
      reset({ name: "" });
    } catch {
      setSubmitError(t("organization.error"));
    }
  });

  const nameError = errors.name ? t(errors.name.message ?? "errors.generic") : undefined;
  const summary: FieldError[] = nameError ? [{ fieldId: "org-name", message: nameError }] : [];

  return (
    <section aria-labelledby="org-heading" className="flex max-w-md flex-col gap-4">
      <h1 id="org-heading" className="text-2xl font-semibold">
        {t("organization.title")}
      </h1>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <ErrorSummary errors={summary} />
        <Field
          id="org-name"
          label={t("organization.nameLabel")}
          {...(nameError ? { error: nameError } : {})}
          {...register("name")}
        />
        {submitError ? (
          <p role="alert" className="text-somnus-danger">
            {submitError}
          </p>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {t("organization.create")}
        </Button>
      </form>

      {activeOrg ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-md border border-somnus-success/40 bg-somnus-success/10 p-3"
        >
          <p>{t("organization.created", { name: activeOrg.name })}</p>
          <div className="flex gap-4">
            <Link to="/organization/members" className="text-somnus-primary underline">
              {t("nav.members")}
            </Link>
            <Link to="/organization/invitations" className="text-somnus-primary underline">
              {t("nav.invitations")}
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
