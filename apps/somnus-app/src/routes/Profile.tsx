import { zodResolver } from "@hookform/resolvers/zod";
import {
  AccountHolderDateOfBirthSchema,
  type MeResponse,
  PhoneSchema,
  type ProfilePatchRequest,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@somnus/api-contracts";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { accountViewOf } from "../auth/account-view.js";
import { useAuth } from "../auth/useAuth.js";
import { Avatar } from "../components/Avatar.js";
import { Button } from "../components/Button.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { LOCALE_LABELS } from "../components/LanguageSwitcher.js";
import { SelectField } from "../components/SelectField.js";
import { edge } from "../lib/edge.js";
import { PhotoPrepFailure, prepareProfilePhoto } from "../lib/photo.js";

// Local form schema with i18n-key messages; the wire contract
// (ProfilePatchRequestSchema) validates the same rules server-side.
const ProfileSchema = z.object({
  firstName: z.string().trim().min(1, "errors.required"),
  lastName: z.string().trim().min(1, "errors.required"),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || PhoneSchema.safeParse(v).success, "profile.errors.phone"),
  dateOfBirth: z
    .string()
    .refine(
      (v) => v === "" || AccountHolderDateOfBirthSchema.safeParse(v).success,
      "profile.errors.dateOfBirth",
    ),
  locale: z.enum(SUPPORTED_LOCALES),
});
type ProfileForm = z.infer<typeof ProfileSchema>;

/**
 * The name always; the optional fields and the language only when they
 * changed. An emptied optional field is cleared with null.
 */
function patchFrom(form: ProfileForm, me: MeResponse): ProfilePatchRequest {
  const current = me.individualProfile;
  const patch: Record<string, unknown> = { firstName: form.firstName, lastName: form.lastName };
  const phone = form.phone === "" ? undefined : form.phone;
  if (phone !== current?.phone) patch["phone"] = phone ?? null;
  const dateOfBirth = form.dateOfBirth === "" ? undefined : form.dateOfBirth;
  if (dateOfBirth !== current?.dateOfBirth) patch["dateOfBirth"] = dateOfBirth ?? null;
  if (form.locale !== me.user.locale) patch["locale"] = form.locale;
  return patch as ProfilePatchRequest;
}

type PhotoStatus = "idle" | "uploading" | "saved" | "removed" | "error" | "tooLarge" | "notImage";

function PhotoSection({ me, onChanged }: { me: MeResponse; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<PhotoStatus>("idle");
  const hasPhoto = Boolean(me.individualProfile?.photoUpdatedAt);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStatus("uploading");
    try {
      await edge.uploadPhoto(await prepareProfilePhoto(file));
      await onChanged();
      setStatus("saved");
    } catch (error) {
      if (error instanceof PhotoPrepFailure && error.reason === "too_large") setStatus("tooLarge");
      else if (error instanceof PhotoPrepFailure && error.reason === "not_an_image")
        setStatus("notImage");
      else setStatus("error");
    }
  };

  const onRemove = async () => {
    setStatus("uploading");
    try {
      await edge.removePhoto();
      await onChanged();
      setStatus("removed");
    } catch {
      setStatus("error");
    }
  };

  const message: Record<Exclude<PhotoStatus, "idle">, string> = {
    uploading: t("profile.photoUploading"),
    saved: t("profile.photoSaved"),
    removed: t("profile.photoRemoved"),
    error: t("profile.photoError"),
    tooLarge: t("profile.photoTooBig"),
    notImage: t("profile.photoNotImage"),
  };
  const isProblem = status === "error" || status === "tooLarge" || status === "notImage";

  return (
    <section aria-labelledby="photo-heading" className="flex flex-col gap-3">
      <h2 id="photo-heading" className="text-lg font-semibold">
        {t("profile.photoTitle")}
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar me={me} className="h-24 w-24 text-3xl" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              id={inputId}
              type="file"
              accept="image/*"
              className="sr-only"
              // The visible button opens it; one tab stop and one name, not two.
              tabIndex={-1}
              aria-label={hasPhoto ? t("profile.changePhoto") : t("profile.choosePhoto")}
              onChange={(event) => void onPick(event)}
            />
            <Button
              variant="secondary"
              disabled={status === "uploading"}
              onClick={() => input.current?.click()}
            >
              {hasPhoto ? t("profile.changePhoto") : t("profile.choosePhoto")}
            </Button>
            {hasPhoto ? (
              <Button
                variant="secondary"
                disabled={status === "uploading"}
                onClick={() => void onRemove()}
              >
                {t("profile.removePhoto")}
              </Button>
            ) : null}
          </div>
          <p className="max-w-sm text-sm text-somnus-subtle">{t("profile.photoHint")}</p>
        </div>
      </div>
      {status !== "idle" ? (
        <p
          role={isProblem ? "alert" : "status"}
          aria-live="polite"
          className={isProblem ? "text-somnus-danger" : "text-somnus-success"}
        >
          {message[status]}
        </p>
      ) : null}
    </section>
  );
}

export function Profile() {
  const { t, i18n } = useTranslation();
  const { state, refresh } = useAuth();
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const me = state.status === "authenticated" ? state.me : null;
  const profile = me?.individualProfile ?? null;
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
      dateOfBirth: profile?.dateOfBirth ?? "",
      locale: me?.user.locale ?? "es",
    },
  });

  const onSubmit = handleSubmit(async (form) => {
    if (!me) return;
    setSaved(false);
    setSubmitError(null);
    const patch = patchFrom(form, me);
    try {
      await edge.patchProfile(patch);
      if (patch.locale) await i18n.changeLanguage(patch.locale);
      await refresh();
      setSaved(true);
    } catch {
      setSubmitError(t("profile.error"));
    }
  });

  const errorOf = (message: string | undefined) => (message ? t(message) : undefined);
  const fieldErrors = {
    firstName: errorOf(errors.firstName?.message),
    lastName: errorOf(errors.lastName?.message),
    phone: errorOf(errors.phone?.message),
    dateOfBirth: errorOf(errors.dateOfBirth?.message),
  };
  const summary: FieldError[] = [
    ["profile-first", fieldErrors.firstName],
    ["profile-last", fieldErrors.lastName],
    ["profile-dob", fieldErrors.dateOfBirth],
    ["profile-phone", fieldErrors.phone],
  ]
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([fieldId, message]) => ({ fieldId, message }));

  if (!me) return null;
  const kind = accountViewOf(me).kind;
  const localeOptions = SUPPORTED_LOCALES.map((locale: SupportedLocale) => ({
    value: locale,
    label: LOCALE_LABELS[locale] ?? locale,
  }));

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <h1 id="profile-heading" className="text-2xl font-semibold">
        {t("profile.title")}
      </h1>

      <PhotoSection me={me} onChanged={refresh} />

      <section aria-labelledby="account-heading" className="flex flex-col gap-3">
        <h2 id="account-heading" className="text-lg font-semibold">
          {t("profile.accountTitle")}
        </h2>
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-sm text-somnus-subtle">{t("profile.email")}</dt>
            <dd className="break-words">{me.user.email}</dd>
          </div>
          <div>
            <dt className="text-sm text-somnus-subtle">{t("profile.accountType")}</dt>
            <dd>{t(`space.accountType.${kind}`)}</dd>
          </div>
        </dl>
        <p className="text-sm text-somnus-subtle">{t("profile.emailHint")}</p>
      </section>

      <section aria-labelledby="details-heading" className="flex flex-col gap-4">
        <h2 id="details-heading" className="text-lg font-semibold">
          {t("profile.detailsTitle")}
        </h2>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <ErrorSummary errors={summary} />
          <Field
            id="profile-first"
            label={t("profile.firstName")}
            autoComplete="given-name"
            {...(fieldErrors.firstName ? { error: fieldErrors.firstName } : {})}
            {...register("firstName")}
          />
          <Field
            id="profile-last"
            label={t("profile.lastName")}
            autoComplete="family-name"
            {...(fieldErrors.lastName ? { error: fieldErrors.lastName } : {})}
            {...register("lastName")}
          />
          <Field
            id="profile-dob"
            label={t("profile.dateOfBirth")}
            hint={t("profile.optional")}
            type="date"
            autoComplete="bday"
            {...(fieldErrors.dateOfBirth ? { error: fieldErrors.dateOfBirth } : {})}
            {...register("dateOfBirth")}
          />
          <Field
            id="profile-phone"
            label={t("profile.phone")}
            hint={t("profile.optional")}
            type="tel"
            autoComplete="tel"
            {...(fieldErrors.phone ? { error: fieldErrors.phone } : {})}
            {...register("phone")}
          />
          <SelectField
            id="profile-locale"
            label={t("profile.language")}
            options={localeOptions}
            {...register("locale")}
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
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
