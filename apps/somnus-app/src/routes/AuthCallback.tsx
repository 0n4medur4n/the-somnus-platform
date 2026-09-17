import { zodResolver } from "@hookform/resolvers/zod";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  MORPHEO_MINOR_AGE_BANDS,
  PROFESSIONAL_SPECIALTIES,
  type RegistrationRequest,
  RegistrationRequestSchema,
  type SupportedLocale,
} from "@somnus/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { z } from "zod";
import { completeEmailLinkSignIn, isEmailLink, storedEmail } from "../auth/firebase-auth.js";
import { useAuth } from "../auth/useAuth.js";
import { Button } from "../components/Button.js";
import { CheckboxField } from "../components/CheckboxField.js";
import { ErrorSummary, type FieldError } from "../components/ErrorSummary.js";
import { Field } from "../components/Field.js";
import { FullPageStatus } from "../components/FullPageStatus.js";
import { SelectField } from "../components/SelectField.js";
import { AuthLayout } from "../layouts/AuthLayout.js";
import {
  type CallbackFailure,
  classifyCallbackFailure,
  describeCallbackFailure,
} from "../lib/auth-failure.js";
import { edge } from "../lib/edge.js";
import { pendingInvitation } from "../lib/invitation.js";
import { reportError } from "../lib/report-error.js";

type Phase = "verifying" | "needs-email" | "register" | "error";

export function AuthCallback() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { state, refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [failure, setFailure] = useState<CallbackFailure>("generic");
  const started = useRef(false);

  /**
   * Redeem the emailed link, exchange it for a session, load the account.
   *
   * Which of the three steps we are in is tracked because the screen used to
   * blame the emailed link for all of them; the log now says which one actually
   * failed, so the next incident is diagnosable from a console rather than from
   * a trace.
   *
   * `onRecoverable` is how the confirmation form keeps someone on the screen for
   * a failure they can fix themselves. A mistyped address fails at `sign-in`
   * with a code that is deliberately NOT `link-invalid` (see `auth-failure.ts`:
   * the link has not expired and is not consumed), so the honest response is
   * "check the address", not a terminal error that strands them.
   */
  const redeem = useCallback(
    async (email: string, onRecoverable?: (message: string) => void) => {
      let stage: "sign-in" | "session" | "account" = "sign-in";
      try {
        const idToken = await completeEmailLinkSignIn(email, window.location.href);
        stage = "session";
        await edge.createSession(idToken);
        stage = "account";
        await refresh();
      } catch (error) {
        // Only the Firebase codes that mean the link itself is unusable get the
        // "request a new one" copy. Anything else says something went wrong
        // without inventing a cause -- sending someone for a fresh link when the
        // session endpoint is failing just loops them through the same error.
        const classified = classifyCallbackFailure(error);
        reportError("auth-callback", { stage, ...describeCallbackFailure(error) });
        if (onRecoverable && classified !== "link-invalid" && stage === "sign-in") {
          onRecoverable(t("callback.emailMismatch"));
          return;
        }
        setFailure(classified);
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
      } catch (error) {
        setFailure(classifyCallbackFailure(error));
        reportError("auth-callback", { stage: "account", ...describeCallbackFailure(error) });
        setPhase("error");
      }
    })();
  }, [redeem, refresh]);

  // An invitation parked before the magic link (Addendum A Checkpoint 14.2)
  // sends the person back to the accept screen instead of straight to the app.
  // Accepting lives in exactly one place, on that screen -- registering here
  // and accepting there keeps a single accept path for new and existing users.
  const invitationToken = pendingInvitation();

  useEffect(() => {
    if (state.status === "authenticated") {
      const target = invitationToken
        ? `/invitation/accept?token=${encodeURIComponent(invitationToken)}`
        : "/app";
      navigate(target, { replace: true });
    } else if (state.status === "needs-registration") setPhase("register");
    else if (state.status === "unauthenticated" && phase !== "verifying") setPhase("error");
  }, [state.status, navigate, phase, invitationToken]);

  if (phase === "error") {
    return (
      <AuthLayout>
        <h1 className="text-2xl font-semibold">{t("callback.title")}</h1>
        <p role="alert" className="text-somnus-danger">
          {failure === "link-invalid" ? t("callback.error") : t("callback.errorGeneric")}
        </p>
      </AuthLayout>
    );
  }

  if (phase === "needs-email") {
    return <ConfirmEmailStep onConfirm={redeem} />;
  }

  if (phase === "register") {
    const locale: SupportedLocale = isSupportedLocale(i18n.resolvedLanguage)
      ? i18n.resolvedLanguage
      : DEFAULT_LOCALE;
    // Arriving through an organization invitation fixes the branch to
    // professional (Addendum A §A1): Nox has no open signup, so there is no
    // role for the invited person to choose.
    return (
      <RegistrationForm
        locale={locale}
        {...(invitationToken ? { lockedRole: "professional" as const } : {})}
        onRegistered={() => void refresh()}
      />
    );
  }

  return <FullPageStatus message={t("callback.verifying")} />;
}

// Messages are i18n keys, translated at render so validation is localized --
// the same shape the Login screen and the registration steps use.
const ConfirmEmailSchema = z.object({
  email: z.string().trim().min(1, "errors.required").email("errors.invalidEmail"),
});
type ConfirmEmailForm = z.infer<typeof ConfirmEmailSchema>;

/**
 * Cross-device confirmation: the address, asked for on a screen.
 *
 * Firebase requires the email to be re-supplied when a magic link is opened
 * where it was not requested, and this used to be a raw `window.prompt` lifted
 * from Firebase's own example -- a browser dialog titled with the origin, in the
 * browser's language rather than the app's, with no validation and no way back
 * from a typo. The Firebase call underneath is untouched; only the UI asking for
 * the address changed.
 *
 * A wrong address is recoverable and is treated that way: the error lands on the
 * field and the person tries again, because the link is still valid and has not
 * been consumed.
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
    <AuthLayout>
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
    </AuthLayout>
  );
}

/**
 * Registration is ONE flow with a role branch, not four forms
 * (Addendum A §A1): step 1 name, step 2 role, step 3 the branch-specific
 * fields plus the consent purposes as separate checkboxes.
 *
 * `parent` is the contract value for the guardian branch -- the same
 * vocabulary Morpheo's role definitions use (§14a). The user-facing copy
 * says "madre, padre o tutor legal"; the wire value never changes.
 */
type RoleBranch = RegistrationRequest["role"];
const ROLE_BRANCHES = ["adult", "parent", "professional"] as const satisfies readonly RoleBranch[];

/**
 * "Step N of M". M is 3 normally, and 2 when the branch is locked by an
 * invitation (Addendum A Checkpoint 14.2): there is no role to choose, so
 * counting a step the person never sees would be a lie.
 */
type StepMeta = { current: number; total: number };

/** Copy keys per branch. The wire value (`parent`) and the label are separate concerns. */
const ROLE_COPY: Record<RoleBranch, { label: string; hint: string }> = {
  adult: { label: "register.roleAdult", hint: "register.roleAdultHint" },
  parent: { label: "register.roleParent", hint: "register.roleParentHint" },
  professional: { label: "register.roleProfessional", hint: "register.roleProfessionalHint" },
};

// Messages are i18n keys, translated at render so validation is localized.
const NameSchema = z.object({
  firstName: z.string().trim().min(1, "errors.required"),
  lastName: z.string().trim().min(1, "errors.required"),
});
type NameForm = z.infer<typeof NameSchema>;

/** Both required purposes, each its own checkbox and its own receipt (build plan §13). */
const ConsentsSchema = z.object({
  termsAcceptance: z.boolean().refine((v) => v, "register.errors.consentRequired"),
  privacyPolicyAcknowledgement: z.boolean().refine((v) => v, "register.errors.consentRequired"),
});

const AdultDetailsSchema = ConsentsSchema.extend({
  ageYears: z
    .number({ error: "register.errors.ageRequired" })
    .int("register.errors.ageMax")
    .min(18, "register.errors.ageMin")
    .max(120, "register.errors.ageMax"),
});
const ParentDetailsSchema = ConsentsSchema.extend({
  guardianshipConfirmed: z.boolean().refine((v) => v, "register.errors.guardianship"),
  minorAgeBand: z.enum(MORPHEO_MINOR_AGE_BANDS, {
    error: "register.errors.minorAgeBandRequired",
  }),
});
const ProfessionalDetailsSchema = ConsentsSchema.extend({
  specialty: z.enum(PROFESSIONAL_SPECIALTIES, { error: "register.errors.specialtyRequired" }),
  licenseNumber: z.string().trim().min(1, "errors.required").max(64, "errors.required"),
});

type AdultDetails = z.infer<typeof AdultDetailsSchema>;
type ParentDetails = z.infer<typeof ParentDetailsSchema>;
type ProfessionalDetails = z.infer<typeof ProfessionalDetailsSchema>;

function StepHeader({ step, title, intro }: { step: StepMeta; title: string; intro: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-somnus-subtle">
        {t("register.stepOf", { current: step.current, total: step.total })}
      </p>
      <h1 className="text-2xl font-semibold text-somnus-text">{title}</h1>
      <p className="text-somnus-subtle">{intro}</p>
    </div>
  );
}

/**
 * `lockedRole` pins the branch and removes the role step entirely. It is set
 * when the person arrived through an organization invitation, where Addendum A
 * §A1 fixes the branch to `professional` -- Nox has no open signup, so there
 * is nothing to choose.
 */
function RegistrationForm({
  locale,
  lockedRole,
  onRegistered,
}: {
  locale: SupportedLocale;
  lockedRole?: RoleBranch;
  onRegistered: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"name" | "role" | "details">("name");
  const [name, setName] = useState<NameForm | null>(null);
  const [role, setRole] = useState<RoleBranch | null>(lockedRole ?? null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const total = lockedRole ? 2 : 3;

  /**
   * The payload is re-validated against the contract before it leaves the
   * browser: the SPA can never send a shape the edge would reject, and a
   * branch field can never be dropped on its way out of the form.
   */
  async function submit(request: RegistrationRequest): Promise<void> {
    setSubmitError(null);
    const parsed = RegistrationRequestSchema.safeParse(request);
    if (!parsed.success) {
      setSubmitError(t("errors.generic"));
      return;
    }
    try {
      await edge.register(parsed.data);
      onRegistered();
    } catch {
      setSubmitError(t("errors.generic"));
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-2xl border border-somnus-subtle/15 bg-somnus-surface p-6 shadow-lg shadow-black/20">
        {step === "name" ? (
          <NameStep
            step={{ current: 1, total }}
            {...(name ? { defaults: name } : {})}
            onNext={(values) => {
              setName(values);
              setStep(lockedRole ? "details" : "role");
            }}
          />
        ) : null}

        {step === "role" ? (
          <RoleStep
            step={{ current: 2, total }}
            {...(role ? { selected: role } : {})}
            onBack={() => setStep("name")}
            onNext={(chosen) => {
              setRole(chosen);
              setStep("details");
            }}
          />
        ) : null}

        {step === "details" && name && role ? (
          <DetailsStep
            role={role}
            name={name}
            locale={locale}
            step={{ current: lockedRole ? 2 : 3, total }}
            locked={lockedRole !== undefined}
            submitError={submitError}
            onBack={() => setStep(lockedRole ? "name" : "role")}
            onSubmit={submit}
          />
        ) : null}
      </div>
    </AuthLayout>
  );
}

function NameStep({
  step,
  defaults,
  onNext,
}: {
  step: StepMeta;
  defaults?: NameForm;
  onNext: (values: NameForm) => void;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NameForm>({
    resolver: zodResolver(NameSchema),
    ...(defaults ? { defaultValues: defaults } : {}),
  });

  const firstNameError = errors.firstName ? t(errors.firstName.message ?? "errors.generic") : "";
  const lastNameError = errors.lastName ? t(errors.lastName.message ?? "errors.generic") : "";
  const summary: FieldError[] = [
    ...(firstNameError ? [{ fieldId: "reg-first", message: firstNameError }] : []),
    ...(lastNameError ? [{ fieldId: "reg-last", message: lastNameError }] : []),
  ];

  return (
    <form onSubmit={handleSubmit(onNext)} noValidate className="flex flex-col gap-4">
      <StepHeader step={step} title={t("register.nameTitle")} intro={t("register.nameIntro")} />
      <ErrorSummary errors={summary} />
      <Field
        id="reg-first"
        label={t("register.firstName")}
        autoComplete="given-name"
        {...(firstNameError ? { error: firstNameError } : {})}
        {...register("firstName")}
      />
      <Field
        id="reg-last"
        label={t("register.lastName")}
        autoComplete="family-name"
        {...(lastNameError ? { error: lastNameError } : {})}
        {...register("lastName")}
      />
      <Button type="submit" className="w-full">
        {t("register.next")}
      </Button>
    </form>
  );
}

function RoleStep({
  step,
  selected,
  onBack,
  onNext,
}: {
  step: StepMeta;
  selected?: RoleBranch;
  onBack: () => void;
  onNext: (role: RoleBranch) => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<RoleBranch | null>(selected ?? null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!choice) {
          setError(t("register.errors.roleRequired"));
          return;
        }
        onNext(choice);
      }}
    >
      <StepHeader step={step} title={t("register.roleTitle")} intro={t("register.roleIntro")} />
      <ErrorSummary errors={error ? [{ fieldId: "reg-role-adult", message: error }] : []} />
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="sr-only">{t("register.roleLegend")}</legend>
        {ROLE_BRANCHES.map((branch) => (
          <label
            key={branch}
            htmlFor={`reg-role-${branch}`}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-somnus-subtle/20 p-4 hover:border-somnus-primary/60"
          >
            <input
              id={`reg-role-${branch}`}
              type="radio"
              name="role"
              value={branch}
              checked={choice === branch}
              onChange={() => {
                setChoice(branch);
                setError(null);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-somnus-primary-strong"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-somnus-text">{t(ROLE_COPY[branch].label)}</span>
              <span className="text-sm text-somnus-subtle">{t(ROLE_COPY[branch].hint)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <StepNav onBack={onBack} submitLabel={t("register.next")} />
    </form>
  );
}

function StepNav({
  onBack,
  submitLabel,
  disabled,
}: {
  onBack: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3">
      <Button variant="secondary" onClick={onBack}>
        {t("register.back")}
      </Button>
      <Button type="submit" disabled={disabled} className="flex-1">
        {submitLabel}
      </Button>
    </div>
  );
}

function ConsentFields({
  termsProps,
  privacyProps,
  termsError,
  privacyError,
}: {
  termsProps: Record<string, unknown>;
  privacyProps: Record<string, unknown>;
  termsError: string;
  privacyError: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="text-sm font-medium text-somnus-text">
        {t("register.consentsTitle")}
      </legend>
      <p className="text-sm text-somnus-subtle">{t("register.consentsHint")}</p>
      <CheckboxField
        id="reg-consent-terms"
        label={t("register.consentTerms")}
        {...(termsError ? { error: termsError } : {})}
        {...termsProps}
      />
      <CheckboxField
        id="reg-consent-privacy"
        label={t("register.consentPrivacy")}
        {...(privacyError ? { error: privacyError } : {})}
        {...privacyProps}
      />
    </fieldset>
  );
}

function DetailsStep(props: {
  role: RoleBranch;
  name: NameForm;
  locale: SupportedLocale;
  step: StepMeta;
  locked: boolean;
  submitError: string | null;
  onBack: () => void;
  onSubmit: (request: RegistrationRequest) => Promise<void>;
}) {
  if (props.role === "adult") return <AdultStep {...props} />;
  if (props.role === "parent") return <ParentStep {...props} />;
  return <ProfessionalStep {...props} />;
}

type BranchStepProps = {
  name: NameForm;
  locale: SupportedLocale;
  step: StepMeta;
  /** True when an organization invitation fixed the branch: no role was chosen. */
  locked: boolean;
  submitError: string | null;
  onBack: () => void;
  onSubmit: (request: RegistrationRequest) => Promise<void>;
};

/** Says plainly why the branch was not offered, when it was decided by an invitation. */
function LockedNotice({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  if (!locked) return null;
  return (
    <p className="rounded-lg border border-somnus-primary/25 bg-somnus-primary/10 p-3 text-sm text-somnus-text">
      {t("register.lockedNotice")}
    </p>
  );
}

function SubmitError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-somnus-danger">
      {message}
    </p>
  );
}

function AdultStep({ name, locale, step, locked, submitError, onBack, onSubmit }: BranchStepProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdultDetails>({ resolver: zodResolver(AdultDetailsSchema) });

  const ageError = errors.ageYears ? t(errors.ageYears.message ?? "errors.generic") : "";
  const termsError = errors.termsAcceptance
    ? t(errors.termsAcceptance.message ?? "errors.generic")
    : "";
  const privacyError = errors.privacyPolicyAcknowledgement
    ? t(errors.privacyPolicyAcknowledgement.message ?? "errors.generic")
    : "";
  const summary: FieldError[] = [
    ...(ageError ? [{ fieldId: "reg-age", message: ageError }] : []),
    ...(termsError ? [{ fieldId: "reg-consent-terms", message: termsError }] : []),
    ...(privacyError ? [{ fieldId: "reg-consent-privacy", message: privacyError }] : []),
  ];

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) =>
        onSubmit({
          role: "adult",
          firstName: name.firstName,
          lastName: name.lastName,
          locale,
          ageYears: values.ageYears,
          consents: {
            termsAcceptance: true,
            privacyPolicyAcknowledgement: true,
          },
        }),
      )}
    >
      <StepHeader step={step} title={t("register.adultTitle")} intro={t("register.adultIntro")} />
      <LockedNotice locked={locked} />
      <ErrorSummary errors={summary} />
      <Field
        id="reg-age"
        label={t("register.ageLabel")}
        hint={t("register.ageHint")}
        type="number"
        inputMode="numeric"
        min={18}
        max={120}
        {...(ageError ? { error: ageError } : {})}
        {...register("ageYears", { valueAsNumber: true })}
      />
      <ConsentFields
        termsProps={register("termsAcceptance")}
        privacyProps={register("privacyPolicyAcknowledgement")}
        termsError={termsError}
        privacyError={privacyError}
      />
      <SubmitError message={submitError} />
      <StepNav onBack={onBack} submitLabel={t("register.submit")} disabled={isSubmitting} />
    </form>
  );
}

function ParentStep({
  name,
  locale,
  step,
  locked,
  submitError,
  onBack,
  onSubmit,
}: BranchStepProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ParentDetails>({ resolver: zodResolver(ParentDetailsSchema) });

  const guardianshipError = errors.guardianshipConfirmed
    ? t(errors.guardianshipConfirmed.message ?? "errors.generic")
    : "";
  const bandError = errors.minorAgeBand ? t(errors.minorAgeBand.message ?? "errors.generic") : "";
  const termsError = errors.termsAcceptance
    ? t(errors.termsAcceptance.message ?? "errors.generic")
    : "";
  const privacyError = errors.privacyPolicyAcknowledgement
    ? t(errors.privacyPolicyAcknowledgement.message ?? "errors.generic")
    : "";
  const summary: FieldError[] = [
    ...(guardianshipError ? [{ fieldId: "reg-guardianship", message: guardianshipError }] : []),
    ...(bandError ? [{ fieldId: "reg-minor-band", message: bandError }] : []),
    ...(termsError ? [{ fieldId: "reg-consent-terms", message: termsError }] : []),
    ...(privacyError ? [{ fieldId: "reg-consent-privacy", message: privacyError }] : []),
  ];

  const bandOptions = MORPHEO_MINOR_AGE_BANDS.map((band) => ({
    value: band,
    label: t(`register.ageBand.${band}`),
  }));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) =>
        onSubmit({
          role: "parent",
          firstName: name.firstName,
          lastName: name.lastName,
          locale,
          guardianshipConfirmed: true,
          minorAgeBand: values.minorAgeBand,
          consents: {
            termsAcceptance: true,
            privacyPolicyAcknowledgement: true,
          },
        }),
      )}
    >
      <StepHeader step={step} title={t("register.parentTitle")} intro={t("register.parentIntro")} />
      <LockedNotice locked={locked} />
      <ErrorSummary errors={summary} />
      <CheckboxField
        id="reg-guardianship"
        label={t("register.guardianshipLabel")}
        hint={t("register.guardianshipHint")}
        {...(guardianshipError ? { error: guardianshipError } : {})}
        {...register("guardianshipConfirmed")}
      />
      <SelectField
        id="reg-minor-band"
        label={t("register.minorAgeBandLabel")}
        placeholder={t("register.minorAgeBandPlaceholder")}
        options={bandOptions}
        {...(bandError ? { error: bandError } : {})}
        {...register("minorAgeBand")}
      />
      <ConsentFields
        termsProps={register("termsAcceptance")}
        privacyProps={register("privacyPolicyAcknowledgement")}
        termsError={termsError}
        privacyError={privacyError}
      />
      <SubmitError message={submitError} />
      <StepNav onBack={onBack} submitLabel={t("register.submit")} disabled={isSubmitting} />
    </form>
  );
}

function ProfessionalStep({
  name,
  locale,
  step,
  locked,
  submitError,
  onBack,
  onSubmit,
}: BranchStepProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfessionalDetails>({ resolver: zodResolver(ProfessionalDetailsSchema) });

  const specialtyError = errors.specialty ? t(errors.specialty.message ?? "errors.generic") : "";
  const licenseError = errors.licenseNumber
    ? t(errors.licenseNumber.message ?? "errors.generic")
    : "";
  const termsError = errors.termsAcceptance
    ? t(errors.termsAcceptance.message ?? "errors.generic")
    : "";
  const privacyError = errors.privacyPolicyAcknowledgement
    ? t(errors.privacyPolicyAcknowledgement.message ?? "errors.generic")
    : "";
  const summary: FieldError[] = [
    ...(specialtyError ? [{ fieldId: "reg-specialty", message: specialtyError }] : []),
    ...(licenseError ? [{ fieldId: "reg-license", message: licenseError }] : []),
    ...(termsError ? [{ fieldId: "reg-consent-terms", message: termsError }] : []),
    ...(privacyError ? [{ fieldId: "reg-consent-privacy", message: privacyError }] : []),
  ];

  const specialtyOptions = PROFESSIONAL_SPECIALTIES.map((specialty) => ({
    value: specialty,
    label: t(`register.specialty.${specialty}`),
  }));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) =>
        onSubmit({
          role: "professional",
          firstName: name.firstName,
          lastName: name.lastName,
          locale,
          specialty: values.specialty,
          licenseNumber: values.licenseNumber,
          consents: {
            termsAcceptance: true,
            privacyPolicyAcknowledgement: true,
          },
        }),
      )}
    >
      <StepHeader
        step={step}
        title={t("register.professionalTitle")}
        intro={t("register.professionalIntro")}
      />
      <LockedNotice locked={locked} />
      <ErrorSummary errors={summary} />
      <SelectField
        id="reg-specialty"
        label={t("register.specialtyLabel")}
        placeholder={t("register.specialtyPlaceholder")}
        options={specialtyOptions}
        {...(specialtyError ? { error: specialtyError } : {})}
        {...register("specialty")}
      />
      <Field
        id="reg-license"
        label={t("register.licenseLabel")}
        hint={t("register.licenseHint")}
        {...(licenseError ? { error: licenseError } : {})}
        {...register("licenseNumber")}
      />
      {/* Addendum A §A1: self-registration never grants professional access. */}
      <p className="rounded-lg border border-somnus-subtle/20 bg-somnus-background/40 p-3 text-sm text-somnus-subtle">
        {t("register.verificationNotice")}
      </p>
      <ConsentFields
        termsProps={register("termsAcceptance")}
        privacyProps={register("privacyPolicyAcknowledgement")}
        termsError={termsError}
        privacyError={privacyError}
      />
      <SubmitError message={submitError} />
      <StepNav onBack={onBack} submitLabel={t("register.submit")} disabled={isSubmitting} />
    </form>
  );
}
