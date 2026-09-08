import { Inject, Injectable } from "@nestjs/common";
import {
  makeEvent,
  type UserProvisionRequest,
  type UserResolveResponse,
} from "@somnus/api-contracts";
import { IndividualProfilesRepository } from "../../infrastructure/db/repositories/individual-profiles.repository.js";
import { ProfessionalProfilesRepository } from "../../infrastructure/db/repositories/professional-profiles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";
import { ConsentService } from "../consent/consent.service.js";

/**
 * Registration provisioning (build plan §20 Checkpoint 9.1): find-or-
 * create the Somnus user behind a Firebase identity and create its
 * individual profile. Called by edge-api's `POST /v1/registration`
 * after the session (and thus the Firebase identity) is established.
 *
 * Idempotent: if the provider id is already linked, the existing user
 * is returned untouched -- re-registration and double-submits are
 * no-ops, never duplicate users or an error. This is the one write path
 * that turns a Firebase account into a Somnus account; the read path
 * (`resolve`) never creates anything.
 */
@Injectable()
export class UsersProvisionService {
  constructor(
    private readonly users: UsersRepository,
    private readonly individualProfiles: IndividualProfilesRepository,
    private readonly professionalProfiles: ProfessionalProfilesRepository,
    // The Consent module's PUBLIC interface -- the only way identity code may
    // reach consent (build plan §261 / Checkpoint 7.1). No consent tables or
    // repositories are touched from here.
    private readonly consent: ConsentService,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async provision(
    input: UserProvisionRequest,
    correlationId?: string,
  ): Promise<UserResolveResponse> {
    const correlation = correlationId ?? input.providerUserId;

    // "Started" is the submission, not the form: the request passed contract
    // validation and is being processed. Emitted once per attempt, so
    // started -> completed measures how often a submitted registration fails
    // (conflict, downstream error), which is what a server can honestly see.
    // Abandonment before submit would need a client-side signal and is not
    // measured here.
    await this.emit("identity.registration.started.v1", correlation, input.providerUserId, {
      roleBranch: input.role,
    });

    const existing = await this.users.findByProviderUserId(input.providerUserId);
    if (existing) {
      const user = await this.users.findById(existing.userId);
      if (user) {
        // Idempotent re-submit: the registration is complete, so the funnel
        // records a completion rather than leaving a started with no end.
        // Counted per attempt, matching "started" -- the dashboard reads a
        // conversion rate, not a user count.
        await this.emit("identity.registration.completed.v1", correlation, user.id, {
          roleBranch: input.role,
        });
        return { userId: user.id, email: user.email, locale: user.locale, status: user.status };
      }
    }

    const locale = input.locale ?? "es";
    const userId = await this.users.create({ email: input.email, locale });
    await this.users.linkIdentity({ userId, providerUserId: input.providerUserId });
    // Every branch is an individual first -- including the professional one.
    // The parent/guardian attestation and the minor's age band are recorded
    // here because the minor never has an account (Addendum A, A1).
    await this.individualProfiles.create({
      userId,
      firstName: input.firstName,
      lastName: input.lastName,
      registrationRole: input.role,
      guardianshipConfirmed: input.role === "parent" ? true : null,
      minorAgeBand: input.role === "parent" ? input.minorAgeBand : null,
    });

    if (input.role === "professional") {
      // Create the profile (verification_status defaults to "pending") and open
      // the case the verifier queue (Checkpoint 15.2) will resolve. Deliberately
      // NO role assignment: a self-declared professional keeps individual
      // permissions until a professional_verifier approves (Addendum A, A1).
      const professionalProfileId = await this.professionalProfiles.create({
        userId,
        specialty: input.specialty,
        licenseNumber: input.licenseNumber,
      });
      const caseId = await this.professionalProfiles.openVerificationCase(professionalProfileId);
      // Opens the verification funnel (§A2.4). The decision half is emitted by
      // the admin console in Checkpoint 15.2.
      await this.emit(
        "identity.professional.verification.requested.v1",
        correlation,
        userId,
        { caseId },
        "verification_case",
      );
    }

    // Consent receipts: ONE PER PURPOSE, never combined (build plan §13). Both
    // purposes apply to every role branch. Health-data processing is
    // deliberately absent -- it is captured at the first assessment
    // (Addendum A, A1). Recorded through ConsentService only.
    for (const purposeKey of ["terms_acceptance", "privacy_policy_acknowledgement"] as const) {
      await this.consent.record({
        userId,
        request: { purposeKey, source: "registration" },
        correlationId: correlationId ?? userId,
      });
    }

    await this.emit("identity.registration.completed.v1", correlation, userId, {
      roleBranch: input.role,
    });

    return { userId, email: input.email, locale, status: "active" };
  }

  /**
   * Analytics emission never blocks registration: a publisher failure must not
   * cost a user their account. The payloads are the `.strict()` contracts in
   * `packages/api-contracts/src/analytics` -- a role branch or an opaque id,
   * never a name, an email or a locale-bearing free-text field.
   */
  private async emit(
    eventType: string,
    correlationId: string,
    subjectId: string,
    data: Record<string, unknown>,
    subjectType = "user",
  ): Promise<void> {
    try {
      await this.events.publish(
        makeEvent({
          eventType,
          producer: "somnus-identity-service",
          correlationId,
          subject: { type: subjectType, id: subjectId },
          data,
        }),
      );
    } catch {
      // Deliberately swallowed: see the method doc.
    }
  }
}
