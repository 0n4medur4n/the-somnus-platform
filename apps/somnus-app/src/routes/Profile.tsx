import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "../auth/useAuth.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";

const ProfileSchema = z.object({
  firstName: z.string().min(1, "errors.required"),
  lastName: z.string().min(1, "errors.required"),
  phone: z.string().optional(),
});
type ProfileForm = z.infer<typeof ProfileSchema>;

export function Profile() {
  const { t } = useTranslation();
  const { state, refresh } = useAuth();
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const profile = state.status === "authenticated" ? state.me.individualProfile : null;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      phone: profile?.phone ?? "",
    },
  });

  const onSubmit = handleSubmit(async ({ firstName, lastName, phone }) => {
    setSaved(false);
    setSubmitError(null);
    try {
      await edge.patchProfile({
        firstName,
        lastName,
        ...(phone && phone.length > 0 ? { phone } : {}),
      });
      await refresh();
      setSaved(true);
    } catch {
      setSubmitError(t("profile.error"));
    }
  });

  const firstNameError = errors.firstName
    ? t(errors.firstName.message ?? "errors.generic")
    : undefined;
  const lastNameError = errors.lastName
    ? t(errors.lastName.message ?? "errors.generic")
    : undefined;
  const summary: FieldError[] = [
    ...(firstNameError ? [{ fieldId: "profile-first", message: firstNameError }] : []),
    ...(lastNameError ? [{ fieldId: "profile-last", message: lastNameError }] : []),
  ];

  return (
    <section aria-labelledby="profile-heading" className="flex max-w-md flex-col gap-4">
      <h1 id="profile-heading" className="text-2xl font-semibold">
        {t("profile.title")}
      </h1>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <ErrorSummary errors={summary} />
        <Field
          id="profile-first"
          label={t("profile.firstName")}
          autoComplete="given-name"
          {...(firstNameError ? { error: firstNameError } : {})}
          {...register("firstName")}
        />
        <Field
          id="profile-last"
          label={t("profile.lastName")}
          autoComplete="family-name"
          {...(lastNameError ? { error: lastNameError } : {})}
          {...register("lastName")}
        />
        <Field
          id="profile-phone"
          label={t("profile.phone")}
          type="tel"
          autoComplete="tel"
          {...register("phone")}
        />
        {submitError ? (
          <p role="alert" className="text-somnus-danger">
            {submitError}
          </p>
        ) : null}
        {saved ? (
          <p role="status" aria-live="polite" className="text-somnus-success">
            {t("profile.saved")}
          </p>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {t("common.save")}
        </Button>
      </form>
    </section>
  );
}
